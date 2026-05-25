
import dotenv from 'dotenv'
//we recommend you to use dotenv to manage your API keys, you can also directly replace process.env.XXX with your API keys in the code below, but please be careful not to leak your keys when sharing the code :)

dotenv.config()
import OpenAI from "openai";
import Marisa from 'marisa';
import SkillComponent from '@core/agent/skill/skill-component';
import SubAgentComponent from '@core/agent/subagent/subagent-component';
import AgentTODOComponent from '@core/agent/todo/todo';
import SkillFile from '@core/agent/skill/skill-file';
import SkillDef from '@core/agent/skill/skill-def';


async function MyAwesomeAgent() {

  const zhipuClient = new OpenAI({
    baseURL: process.env.ZHIPU_BASE_URL,
    apiKey: process.env.ZHIPU_APIKEY
  })

  const deepseekClient = new OpenAI({
    baseURL: process.env.DS_BASE_URL,
    apiKey: process.env.DS_APIKEY
  })

  const consolidateModel = Marisa.createChatModel().OpenAICompatible('.marisa', 'deepseek-v4-flash', deepseekClient)
  const embeddingModel = Marisa.createEmbeddingModel().OpenAI('embedding-3', zhipuClient)
  const memory = Marisa.Memory.createLayerMarisaMemorySystem(consolidateModel, embeddingModel)

  // a plugin demo to let Agent read your steamapps
  // you can also create your own plugin to let Agent interact with your local files, databases or APIs
  const steamGame = new Marisa.BuiltIn.Plugin.SteamGame('D:/Program/Steam/steamapps')

  //you can use chain to build your agent's logic, for example, we build an agent that can read user's steam game library and then answer questions about the games

  const def = new SkillDef("how-to-work",{
    name:'how-to-work',
    description:"way to work"
  },'GO FOR WORK')

  const skill = new SkillComponent()
  skill.addSkill(def)
  const subagent = new SubAgentComponent()
  const todo = new AgentTODOComponent()

  Marisa.createAgent().OpenAICompatible('.marisa', 'deepseek-v4-flash', deepseekClient)
    .useMemory(memory)
    .useComponent(skill)
    .useComponent(subagent)
    .useComponent(todo)
    .useModelCfg({
      parallelToolCalls: true,
      maxCompletionTokens: 4000,
      temperature: 0.2
    })
    .config({
      enableSubAgent: true
    })
    .useTool(...Marisa.BuiltIn.Tool.AgentCliDefaultTools)
    .usePlugin(steamGame)
    .ready().then((agent) => {
      agent.endpoint(Marisa.EndPoint.CliEndPoint)
    })

}

// 🚀 Launched
MyAwesomeAgent()

