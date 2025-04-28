import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';
import { openai } from '@ai-sdk/openai';
import { isTestEnvironment } from '../constants';
import {
  artifactModel,
  chatModel,
  reasoningModel,
  titleModel,
} from './models.test';

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model': chatModel,
        'chat-model-reasoning': reasoningModel,
        'title-model': titleModel,
        'artifact-model': artifactModel,
      },
    })
  : customProvider({
      languageModels: {
        'chat-model': openai.responses('gpt-4.1'),
        'chat-model-reasoning': wrapLanguageModel({
          model: openai.responses('o3'),
          middleware: extractReasoningMiddleware({ tagName: 'think' }),
        }),
        'title-model': openai.responses('gpt-4.1'),
        'artifact-model': openai.responses('o3'),
      },
      imageModels: {
        'small-model': openai.image('gpt-image-1'),
      },
    });
