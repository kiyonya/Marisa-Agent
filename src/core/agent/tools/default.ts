import AskUserQuestion from "./ask-user-question";
import Bash from "./bash";
import OpenFileOrURL from "./openfile-url";
import ReadFile from "./readfile";
import WebAjax from "./web-ajax";
import WriteFile from "./writefile";

const AgentCliDefaultTools = [ReadFile,WriteFile,OpenFileOrURL,Bash,AskUserQuestion,WebAjax]
const SubAgentDefaultTools = [ReadFile,WriteFile,Bash]

export {AgentCliDefaultTools,SubAgentDefaultTools}