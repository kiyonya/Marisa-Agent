
import dotenv from 'dotenv'
dotenv.config()

import OpenAI from "openai";
import OpenAIAgent from "./src/core/agent/openai-agent";
import FormatPrint from "./src/core/use/format_print";
import OpenAIChatModel from './src/core/model/chat/openai-chat-model';
import OpenAIEmbeddingModel from './src/core/model/embedding/openai-embedding-model';

import { AgentCliDefaultTools } from '@core/agent/tools/default';
import SteamGamePlugin from './src/plugins/steam-game';
import LayerMarisaMemorySystem from '@core/contextual/manager/layer-marisa-memory-system';

import CliEndPoint from '@core/endpoint/cli-endpoint';

const zhipuClient = new OpenAI({
  baseURL: process.env.ZHIPU_BASE_URL,
  apiKey: process.env.ZHIPU_APIKEY
})
const mimoClient = new OpenAI({
  baseURL: process.env.MIMO_BASE_URL,
  apiKey: process.env.MIMO_APIKEY
})
const deepseekClient = new OpenAI({
  baseURL: process.env.DS_BASE_URL,
  apiKey: process.env.DS_APIKEY
})

async function agentic() {

  const consolidateModel = new OpenAIChatModel('.marisa', 'deepseek-v4-flash', deepseekClient)
  const embeddingModel = new OpenAIEmbeddingModel('embedding-3', zhipuClient)
  const memory = new LayerMarisaMemorySystem(consolidateModel, embeddingModel)

  const steamGame = new SteamGamePlugin('D:/Program/Steam/steamapps')

  const agent = await new OpenAIAgent('.marisa', 'deepseek-v4-flash', deepseekClient)
    .useMemory(memory)
    .useModelCfg({
      parallelToolCalls: true,
      maxCompletionTokens: 4000,
      temperature: 0.2
    })
    .config({
      enableSubAgent: true
    })
    .useTool(...AgentCliDefaultTools)
    .usePlugin(steamGame)
    .on('subAgentCreate', console.log)
    .on('subAgentComplete', console.log)
    .ready()

  agent.on('toolCallResult', FormatPrint.printToolCallResult)


  const ep = new CliEndPoint(agent)
  ep.start()

}
agentic()
