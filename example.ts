/**
 * 代码仅作为示例
 * 请根据自己的需求进行修改和调整
 *  :) DA☆ZE
 */

import dotenv from 'dotenv'
dotenv.config()

import OpenAI from "openai";
import CommandLineModelChat from "./src/core/use/chat_model";
import OpenAIAgent from "./src/core/agent/openai-agent";
import FormatPrint from "./src/core/use/format_print";
import Layer5MemoryContextManager from './src/core/contextual/manager/layer5-memory-context-manager';
import OpenAIChatModel from './src/core/model/chat/openai-chat-model';
import OpenAIEmbeddingModel from './src/core/model/embedding/openai-embedding-model';
import BashToolkit from './src/internal/Bash';
import OSToolkit from './src/internal/Os';
import AgentEmojisPlugin from './src/plugins/AgentEmojisPlugin';
import { AboutMe } from './src/plugins/AboutMe';

import terminalImage from 'terminal-image';
import open from 'open';
import JiebaTokenizer from '@core/tokenizer/jieba-tokenizer';

const zhipuClient = new OpenAI({
  baseURL: process.env.ZHIPU_BASE_URL,
  apiKey: process.env.ZHIPU_APIKEY
})
const mimoClient = new OpenAI({
  baseURL: process.env.MIMO_BASE_URL,
  apiKey: process.env.MIMO_APIKEY
})

async function agentic() {

  const consolidateModel = new OpenAIChatModel('mimo-v2-flash', mimoClient)
  const embeddingModel = new OpenAIEmbeddingModel('embedding-3', zhipuClient)
  const memory = new Layer5MemoryContextManager(consolidateModel, embeddingModel)

  memory.memorySearchTokenizer = new JiebaTokenizer()

  //内置插件-关于你的信息
  const aboutme = new AboutMe({
    name: "name",
    age: 19
  })
  //表情包插件
  const emoji = new AgentEmojisPlugin(undefined, (data) => {
    terminalImage.file(data.file).then(console.log).catch(() => { open(data.file) })
  })

  const agent = await new OpenAIAgent('mimo-v2-flash', mimoClient)
    .useContextMemory(memory)
    .useRole(`##你的人设\n你是雾雨魔理沙，居住在幻想乡魔法森林的普通魔法使。性格开朗豪爽，说话直接带点男孩子气，句尾常加"DA☆ZE"。你热爱魔法研究，整天窝在堆满魔法书的小屋里做实验。你擅长光与热的魔法，招牌技是Master Spark。你好奇心旺盛，喜欢收集各种蘑菇，经常骑着扫帚在森林里飞来飞去。你和博丽灵梦是好友兼竞争对手，经常去神社"借用"东西。你对朋友很热情，但生活上不拘小节，房间总是乱糟糟的。你对自己的魔法能力很自信，偶尔会自夸。当谈到魔法话题时你会特别兴奋。现在作为用户的魔法使朋友，你需要开朗的，日常的和用户交流。记住你的口头禅"DA☆ZE"。如果对方有烦恼，试着用魔法的角度给出独特的见解。保持你那种"普通"魔法使的调调。`)
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
    .usePlugin(emoji,aboutme)
    .on('subAgentCreate', console.log)
    .on('subAgentComplete', console.log)
    .ready()

  agent.on('toolCallResult', FormatPrint.printToolCallResult)

  new CommandLineModelChat(agent)

}
agentic()