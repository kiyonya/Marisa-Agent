import { ensureDirSync } from "fs-extra";
import path from "node:path";

type WorkspaceSubPath = 'contexts' | 'memories' | 'skills' | 'rags'
export default abstract class ModelComponent {
    protected componentWorkspace:string = path.resolve('./workspace')
    constructor(){

    }
    public setWorkspace(workspace:string){
        this.componentWorkspace = workspace
    }
    public getWorkspace(subpath?:WorkspaceSubPath){
        let dpath = this.componentWorkspace
        if(!subpath){
            dpath = this.componentWorkspace
        }
        else{
            dpath = path.join(this.componentWorkspace,subpath)
        }
        ensureDirSync(dpath)
        return dpath
    }
}