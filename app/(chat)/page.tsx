import { Chat } from '@/components/chat';
// Remove DEFAULT_CHAT_MODEL import if no longer needed elsewhere
// import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import { generateUUID } from '@/lib/utils';
import { DataStreamHandler } from '@/components/data-stream-handler';
import { auth } from '../(auth)/auth';
import { redirect } from 'next/navigation';
// Remove cookies import if no longer needed elsewhere
// import { cookies } from 'next/headers';

export default async function Page() {
  const session = await auth();

  if (!session) {
    redirect('/api/auth/guest');
  }

  const id = generateUUID();

  // Remove cookie logic
  // const cookieStore = await cookies();
  // const modelIdFromCookie = cookieStore.get('chat-model');

  // Always render Chat without selectedChatModel
  return (
    <>
      <Chat
        key={id}
        id={id}
        initialMessages={[]}
        // Remove selectedChatModel prop
        // selectedChatModel={modelIdFromCookie?.value ?? DEFAULT_CHAT_MODEL}
        selectedVisibilityType="private"
        isReadonly={false}
        session={session}
      />
      <DataStreamHandler id={id} />
    </>
  );
}
