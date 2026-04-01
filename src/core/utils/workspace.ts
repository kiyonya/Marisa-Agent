import path from "node:path"
import { ensureDirSync } from "fs-extra"
const workspace = path.resolve(process.env.WORKSPACE || 'workspace')
type WorkSpacePathes = 'memory' | 'content' | 'contexts' | 'vec'
export function getWorkspacePath(dir: WorkSpacePathes) {
    const target = path.join(workspace, dir)
    ensureDirSync(target)
    return target
}