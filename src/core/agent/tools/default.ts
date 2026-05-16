import AskUserQuestion from "./ask-user-question";
import Bash from "./bash";
import OpenFileOrURL from "./openfile-url";
import ReadFile from "./readfile";
import WriteFile from "./writefile";

const AgentCliDefaultTools = [ReadFile,WriteFile,OpenFileOrURL,Bash,AskUserQuestion]
const SubAgentDefaultTools = [ReadFile,WriteFile,Bash]

export {AgentCliDefaultTools,SubAgentDefaultTools}