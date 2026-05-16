
import EventEmitter from "events"
import { ensureDirSync } from "fs-extra"
import path from "path"

type WorkspaceSubPath = 'contexts' | 'memories' | 'skills' | 'memories/categories' | 'memories/vector' | 'memories/search' | 'memories/hybrid' | 'temp'

export default abstract class ComponentInstaller<Manifest extends Record<any,any> = {}> extends EventEmitter {

    public workspace: string

    constructor(workspace: string) {
        super()
        this.workspace = path.resolve(workspace)
    }

    public getWorkspace(subpath?: WorkspaceSubPath) {
        let dpath = this.workspace
        if (!subpath) {
            dpath = this.workspace
        }
        else {
            dpath = path.join(this.workspace, subpath)
        }
        ensureDirSync(dpath)
        return dpath
    }

    public abstract createInstallManifest():Promise<Manifest> | Manifest

}