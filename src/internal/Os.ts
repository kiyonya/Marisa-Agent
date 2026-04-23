import ToolGroup from "../core/tool/tool-group";
import os from 'os'
const OSToolkit = new ToolGroup({
    name: "os",
    version: "0.0.1"
})

OSToolkit.tool('get_device_info', "获取设备信息", () => {
    const cpus = os.cpus()
    const cpuModel = cpus[0]?.model || 'unknown'
    return {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        cpuModel: cpuModel,
        cpuCores: cpus.length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        uptime: os.uptime(),
        hostname: os.hostname(),
        userInfo: os.userInfo()
    }
}, {})

export default OSToolkit