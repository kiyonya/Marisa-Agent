type CommandHandler = (...args: string[]) => string

type SlashCommandHandler = (...args: string[]) => void | Promise<void>

export default class CommandProcessor {
    private static slashCommandHead = "/"
    private static mentionCommandHead = "@"
    private readonly splitter = " "

    public mentionCommands = new Map<string, CommandHandler>()
    public slashCommands = new Map<string, SlashCommandHandler>()

    get size(){
        return this.mentionCommands.size + this.slashCommands.size
    }

    public registerMentionCommand(command: string, handler: CommandHandler) {
        this.mentionCommands.set(command, handler)
    }

    public registerSlashCommand(command: string, handler: SlashCommandHandler) {
        this.slashCommands.set(command, handler)
    }

    public concat(processor: CommandProcessor) {
        const mentionCommands = processor.mentionCommands
        for (const [cmd, handler] of mentionCommands.entries()) {
            if(this.mentionCommands.has(cmd)){
                throw new Error(`Cannot concat same mention command ${cmd}`)
            }
            this.registerMentionCommand(cmd, handler)
        }
        const slashCommands = processor.slashCommands
        for (const [cmd, handler] of slashCommands.entries()) {
             if(this.slashCommands.has(cmd)){
                throw new Error(`Cannot concat same slash command ${cmd}`)
            }
            this.registerSlashCommand(cmd, handler)
        }
        return this
    }

    public async run(input: string): Promise<null | string> {
        const isSlash = this.isSlashCommand(input)
        if (isSlash) {
            await this.runSlashCommand(input)
            return null
        }
        else {
            input = this.runMentionCommand(input)
        }
        return input
    }

    public runMentionCommand(input: string): string {
        if (!this.mentionCommands.size) {
            return input
        }
        const inputChars = input.split("")
        inputChars.push(this.splitter)

        const matchItems: { command: string, args: string[], handler: CommandHandler, s: number, e: number }[] = []

        let mode: "mcmd" | "mprm" | null = null
        let pendingCommand: string = ""
        let pendingParam: string = ""
        let currentCommand: string = ""
        let currentHandler: CommandHandler | null = null
        let currentMatchedParams: string[] = []
        let needMatchParamsCount: number = 0
        let s: number = 0

        for (let i = 0; i < inputChars.length; i++) {
            const char = inputChars[i] as string

            if (char === CommandProcessor.mentionCommandHead) {
                mode = 'mcmd'
                s = i
            }
            if (char === this.splitter) {
                if (pendingCommand && mode === 'mcmd') {
                    const command = pendingCommand.substring(1)
                    if (this.mentionCommands.has(command)) {
                        const handler = this.mentionCommands.get(command) as CommandHandler
                        currentHandler = handler
                        needMatchParamsCount = handler.length
                        mode = 'mprm'
                        pendingCommand = ""
                        currentCommand = command
                    }
                    pendingCommand = ""
                }
                else if (mode === 'mprm') {
                    currentMatchedParams.push(pendingParam)
                    pendingParam = ''
                    if (currentMatchedParams.length === needMatchParamsCount) {
                        if (currentHandler && currentCommand) {
                            matchItems.push({
                                command: currentCommand,
                                args: currentMatchedParams,
                                handler: currentHandler as CommandHandler,
                                s: s,
                                e: i
                            })
                        }
                        currentMatchedParams = []
                        mode = null
                    }
                }
                continue
            }
            if (mode === 'mcmd') {
                pendingCommand += char
            }
            else if (mode === 'mprm') {
                pendingParam += char
            }
            if (i === inputChars.length - 1) {
                if (mode === 'mprm' && pendingParam) {
                    currentMatchedParams.push(pendingParam)
                    pendingParam = ''
                }
                if (currentMatchedParams.length === needMatchParamsCount) {
                    if (currentHandler && currentCommand) {
                        matchItems.push({
                            command: currentCommand,
                            args: currentMatchedParams,
                            handler: currentHandler as CommandHandler,
                            s: s,
                            e: i
                        })
                    }
                    currentMatchedParams = []
                    mode = null
                }

            }
        }
        for (const match of matchItems) {
            const replace = match.handler(...match.args)
            const size = match.e - match.s
            const placehold = new Array(size).fill(undefined)
            placehold[0] = replace
            for (let i = 0; i < placehold.length; i++) {
                const offsetIdx = i + match.s
                inputChars[offsetIdx] = placehold[i]
            }
        }
        const result = inputChars.filter(i => i !== undefined).join("")
        return result
    }

    public async runSlashCommand(input: string): Promise<void> {
        if (!this.slashCommands.size) { return }
        const chunks = input.split(this.splitter).map(i => i.trim()).filter(Boolean)
        const command = chunks[0]?.substring(1) as string
        const handler = this.slashCommands.get(command) as SlashCommandHandler
        if (handler) {
            const needParamCount = handler.length
            const params = chunks.slice(1, 1 + needParamCount) as string[]
            await handler(...params)
        }
    }

    public isSlashCommand(input: string): boolean {
        if (input.trim().startsWith(CommandProcessor.slashCommandHead)) { return true }
        return false
    }

    public static IsSlashCommand(input: string): boolean {
        if (input.trim().startsWith(this.slashCommandHead)) { return true }
        return false
    }

}
