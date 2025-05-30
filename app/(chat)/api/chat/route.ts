import {
  appendClientMessage,
  appendResponseMessages,
  createDataStreamResponse,
  smoothStream,
  streamText,
} from 'ai';
import { auth, type UserType } from '@/app/(auth)/auth';
import { systemPrompt } from '@/lib/ai/prompts';
import {
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { generateUUID, getTrailingMessageId } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { TavilyClient } from '@agentic/tavily';

export const maxDuration = 60;

// Instantiate Agentic clients
const tavily = new TavilyClient();

// Create AI SDK compatible tools
// Remove: const agenticTools = createAISDKTools({ tavily }); 

// Revert schema changes - Keep original schema
// Remove: const simplifiedPostRequestBodySchema = postRequestBodySchema.omit({ selectedChatModel: true });
// Remove: type SimplifiedPostRequestBody = Omit<PostRequestBody, 'selectedChatModel'>;


export async function POST(request: Request) {
  let requestBody: PostRequestBody; // Use original type

  try {
    const json = await request.json();
    // Parse using the original schema
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new Response('Invalid request body', { status: 400 });
  }

  try {
    // Re-add selectedChatModel to destructuring
    const { id, message, selectedChatModel } = requestBody;

    const session = await auth();

    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new Response(
        'You have exceeded your maximum number of messages for the day! Please try again later.',
        {
          status: 429,
        },
      );
    }

    const chat = await getChatById({ id });

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message,
      });

      await saveChat({ id, userId: session.user.id, title });
    } else {
      if (chat.userId !== session.user.id) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    const previousMessages = await getMessagesByChatId({ id });

    // Convert DB messages to the expected AI SDK Message type
    const formattedPreviousMessages = previousMessages.map(msg => ({
      id: msg.id,
      role: msg.role as 'user' | 'assistant' | 'system',
      content: '', // Add the missing content field
      parts: msg.parts as any, // Assuming parts structure is compatible or needs further mapping
      createdAt: msg.createdAt,
      experimental_attachments: msg.attachments as any ?? [],
      // Add other fields required by the 'Message' type if necessary
    }));

    const messages = appendClientMessage({
      messages: formattedPreviousMessages, // Use the formatted array
      message,
    });

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: 'user',
          parts: message.parts,
          attachments: message.experimental_attachments ?? [],
          createdAt: new Date(),
        },
      ],
    });

    // --- Tavily Search Call --- 
    try {
      console.log(`[Tavily] Searching for: ${message.content}`);
      const searchResults = await tavily.search(message.content);
      console.log('[Tavily] Search Results:', JSON.stringify(searchResults, null, 2));
      // TODO: Use searchResults to augment messages or context for the LLM if needed
    } catch (error) {
      console.error('[Tavily] Search failed:', error);
      // Decide how to handle Tavily errors (e.g., proceed without search results?)
    }
    // --- End Tavily Search Call ---

    // Define execute function within scope to capture variables
    const executeStream = (dataStream: any) => {
       const result = streamText({
         model: myProvider.languageModel(selectedChatModel),
         system: systemPrompt({ selectedChatModel }),
         messages,
         maxSteps: 5, 
         experimental_activeTools:
           selectedChatModel === 'chat-model-reasoning'
             ? []
             : [ 
                 'getWeather',
                 'createDocument',
                 'updateDocument',
                 'requestSuggestions',
               ],
         experimental_transform: smoothStream({ chunking: 'word' }),
         experimental_generateMessageId: generateUUID,
         tools: {
           getWeather,
           createDocument: createDocument({ session, dataStream }),
           updateDocument: updateDocument({ session, dataStream }),
           requestSuggestions: requestSuggestions({
             session,
             dataStream,
           }),
         },
         onFinish: async ({ response }: { response: any }) => {
           if (session.user?.id) {
             try {
               const assistantId = getTrailingMessageId({
                 messages: response.messages.filter(
                   (message: any) => message.role === 'assistant',
                 ),
               });

               if (!assistantId) {
                 throw new Error('No assistant message found!');
               }

               const [, assistantMessage] = appendResponseMessages({
                 messages: [message], // Ensure 'message' (the user message) is captured correctly
                 responseMessages: response.messages,
               });

               await saveMessages({
                 messages: [
                   {
                     id: assistantId,
                     chatId: id, // Ensure 'id' (chatId) is captured correctly
                     role: assistantMessage.role,
                     parts: assistantMessage.parts,
                     attachments:
                       assistantMessage.experimental_attachments ?? [],
                     createdAt: new Date(),
                   },
                 ],
               });
             } catch (_) {
               console.error('Failed to save chat');
             }
           }
         },
         experimental_telemetry: {
           isEnabled: isProductionEnvironment,
           functionId: 'stream-text',
         },
       });

       result.consumeStream();

       result.mergeIntoDataStream(dataStream, {
         sendReasoning: true,
       });
    };

    return createDataStreamResponse({
      execute: executeStream, // Pass the function here
      onError: () => {
        return 'Oops, an error occurred!';
      },
    });

  } catch (_) {
    return new Response('An error occurred while processing your request!', {
      status: 500,
    });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  const session = await auth();

  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const chat = await getChatById({ id });

    if (chat.userId !== session.user.id) {
      return new Response('Forbidden', { status: 403 });
    }

    const deletedChat = await deleteChatById({ id });

    return Response.json(deletedChat, { status: 200 });
  } catch (error) {
    return new Response('An error occurred while processing your request!', {
      status: 500,
    });
  }
}
