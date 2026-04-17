/**
 * 代码仅作为示例
 */

import dotenv from 'dotenv'
dotenv.config()

import OpenAI from "openai";
import CommandLineModelChat from "./src/core/use/chat_model";
import OpenAIAgent from "./src/core/agent/provider/OpenAIAgent";
import FormatPrint from "./src/core/use/format_print";
import L5MemoryOSContextManager from './src/core/context/L5MemoryOSContextManager';
import OpenAIModel from './src/core/model/provider/OpenAIModel';
import OpenAIEmbeddingModel from './src/core/model/embedding/provider/OpenAIEmbedding';
import BashToolkit from './src/internal/Bash';
import OSToolkit from './src/internal/Os';
import TavilySearchPlugin from './src/plugins/TavilySearchPlugin';

const zhipuClient = new OpenAI({
  baseURL: process.env.ZHIPU_BASE_URL,
  apiKey: process.env.ZHIPU_APIKEY
})
const mimoClient = new OpenAI({
  baseURL: process.env.MIMO_BASE_URL,
  apiKey: process.env.MIMO_APIKEY
})

async function agentic() {

  const consolidateModel = new OpenAIModel('mimo-v2-flash', mimoClient)
  const embeddingModel = new OpenAIEmbeddingModel('embedding-3', zhipuClient)

  const memory = new L5MemoryOSContextManager(consolidateModel, embeddingModel)
  console.log(memory.buildMemoryCategoriesIndex())

  const tavily = new TavilySearchPlugin('your_tavily_apikey')

  const agent = await new OpenAIAgent('mimo-v2-flash', mimoClient)
    .useContextMemory(memory)
    .useRole(`你是一个聊天伙伴，你说话就要像人一样使用语句和标点符号`)
    .useModelCfg({
      parallelToolCalls: true,
      maxCompletionTokens: 4000,
      temperature: 0.2,
      enableProgressiveTools: true
    })
    .useToolkits(BashToolkit, OSToolkit)
    .config({
      enableSubAgent: true
    })
    .usePlugin(tavily)
    .on('subAgentCreate', console.log)
    .on('subAgentComplete', console.log)
    .ready()


  console.log(agent.buildRoundTool().map(i => i.toolName))
  agent.on('toolCallResult', FormatPrint.printToolCallResult)
  agent.modelToolCallInterceptor = (tool, name, args) => {
    return tool
  }

  new CommandLineModelChat(agent)
}

agentic()