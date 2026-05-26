import AskUserQuestion from "./ask-user-question";
import Bash from "./bash";
import ListDir from "./list-dir";
import OpenFileOrURL from "./openfile-url";
import ReadFile from "./readfile";
import WebAjax from "./web-ajax";
import WriteFile from "./writefile";

const AgentCliDefaultTools = [ReadFile,WriteFile,OpenFileOrURL,Bash,AskUserQuestion,WebAjax,ListDir]
const SubAgentDefaultTools = [ReadFile,WriteFile,Bash,ListDir]

export {AgentCliDefaultTools,SubAgentDefaultTools}