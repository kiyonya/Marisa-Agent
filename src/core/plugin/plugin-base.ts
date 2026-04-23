import PluginInstaller from "./plugin-installer";

export default abstract class PluginBase {
    public pluginName: string
    public installFunction:((installer:PluginInstaller)=>void) | null = null
    constructor(pluginName: string) {
        this.pluginName = pluginName
    }
}