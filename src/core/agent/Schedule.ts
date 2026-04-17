import Model from "../model/Model";
import corn, { CronTime } from 'cron'
import LocalTool from "../tool/LocalTool";
import z from "zod";


interface Schedule {
    prompt: string,
    type: 'once' | 'corn'
    corn: string,
    id: string
}

interface ScheduleExecItem {
    id: string,
    nextTime: number,
    failedTime?: number,
}

export default class ScheduleManager {
    private workspace: string
    private chatModel: Model

    private scheduleMap = new Map<string, Schedule>()
    private schedulesExecMinHeap: ScheduleExecItem[] = []
    private pendingInsertSchedules: ScheduleExecItem[] = []
    private interval: NodeJS.Timeout | null = null

    private addScheduleTool: LocalTool<{ schedule: Omit<Schedule, 'id'> }>

    private static readonly CORN_PROMPT = `
        ## Cron表达式的结构
        一个Cron表达式通常包含以下字段：
        - 秒（0-59）
        - 分钟（0-59）
        - 小时（0-23）
        - 日期（1-31）
        - 月份（1-12 或 JAN-DEC）
        - 星期几（1-7 或 SUN-SAT，其中1代表星期日）
        - 年份（可选字段）
        每个字段可以使用数字、字符和特殊符号来定义。例如，"0 0 12 ? * WED" 表示在每个星期三的中午12点执行任务。
        特殊字符的含义
        Cron表达式中的特殊字符具有特定的含义：
        *（星号）：表示任何可能的值，例如在分钟字段中使用表示“每分钟”。
        ?（问号）：表示不指定值，仅用于日期和星期几字段，以避免冲突。
        -（连字符）：表示一个范围，例如10-12在小时字段中表示从10点到12点。
        ,（逗号）：用于列出多个值，例如MON,WED,FRI在星期几字段中表示周一、周三和周五。
        /（斜线）：表示增量，例如0/15在秒字段中表示从0秒开始，每15秒执行一次。
        L（字母L）：表示最后，6L可以用在日期字段中表示每个月的最后一个星期五。
        W（字母W）：表示工作日，15W表示最接近每个月15号的工作日。
        #（井号）：用于指定月份中的第几个星期几，例如6#3表示每个月的第三个星期五。

        ## 示例
        -  */5 * * * * ?：每5秒执行一次。
        -  0 0/2 * * * ?：每2分钟执行一次。
        -  0 0 2 1 * ?：每月1号凌晨2点执行一次。
        -  0 15 10 ? * MON-FRI：周一至周五每天上午10:15执行。
        -  0 0 10,14,16 * * ?：每天上午10点、下午2点和4点执行`

    constructor(workspace: string, chatModel: Model) {
        this.chatModel = chatModel
        this.workspace = workspace
        const toolDescription = `
        添加定时任务,相同的任务请务必只创建一次，创建成功后返回任务id,请不要重复创建相同的任务，否则会导致重复执行！\n${ScheduleManager.CORN_PROMPT}`

        this.addScheduleTool = new LocalTool<{ schedule: Omit<Schedule, 'id'> }>('add_schedule', toolDescription, ({ schedule }) => {
            const ids = this.addSchedule(schedule)
            return `成功添加定时任务，ID: ${ids?.join(',')}`
        }, {
            schedule: z.object({
                prompt: z.string().describe('调度任务的提示词'),
                type: z.enum(['once', 'corn']).describe('调度类型，once表示一次性调度，corn表示周期性调度'),
                corn: z.string().describe('Corn表达式，六位格式')
            })
        })
    }

    public init() {
        const date = new Date()
        for (const [id, schedule] of this.scheduleMap.entries()) {
            try {
                const nextTime = new CronTime(schedule.corn).getNextDateFrom(date).toMillis()
                this.schedulesExecMinHeap.push(
                    {
                        nextTime: nextTime,
                        id: id
                    }
                )
            } catch (error) {
                this.scheduleMap.delete(id)
            }
        }
        this.schedulesExecMinHeap.sort((a, b) => a.nextTime - b.nextTime)
        this.startTick()
        return this.addScheduleTool
    }

    public startTick() {
        if (this.interval) return
        this.interval = setInterval(() => {
            this.tickSchedule()
        }, 500)
        this.tickSchedule()
    }

    public endTick() {
        if (this.interval) {
            clearInterval(this.interval)
            this.interval = null
        }
    }

    public tickSchedule() {
        for (const schedule of this.pendingInsertSchedules) {
            this.schedulesExecMinHeap.push(schedule)
        }
        this.pendingInsertSchedules = []
        this.schedulesExecMinHeap.sort((a, b) => a.nextTime - b.nextTime)

        const now = Date.now()
        const execSchedules: ScheduleExecItem[] = []
        for (let i = 0; i < this.schedulesExecMinHeap.length; i++) {
            const scheduleExecItem = this.schedulesExecMinHeap[i]
            if (scheduleExecItem && scheduleExecItem.nextTime <= now) {
                execSchedules.push(scheduleExecItem)
                this.schedulesExecMinHeap.splice(i, 1)
                i--
            } else {
                break
            }
        }
        if (execSchedules.length > 0) {
            console.log(`Executing schedules: ${execSchedules.map(i => i.id).join(',')}`)
        }
        for (const exec of execSchedules) {
            const id = exec.id
            const schedule = this.scheduleMap.get(id)
            if (!schedule) {
                continue
            }

            this.execSchedule(schedule).then(() => {
                if (schedule.type === 'corn') {
                    try {
                        const nextTime = new CronTime(schedule.corn).getNextDateFrom(new Date()).toMillis()
                        this.pendingInsertSchedules.push({ id: id, nextTime: nextTime })
                    } catch (error) {
                        this.scheduleMap.delete(id)
                    }
                }
                else {
                    this.scheduleMap.delete(id)
                }
            }).catch(() => {
                if (schedule.type === 'corn' && (!exec.failedTime || exec.failedTime <= 3)) {
                    const nextTime = new CronTime(schedule.corn).getNextDateFrom(new Date()).toMillis()
                    this.pendingInsertSchedules.push({ id: id, nextTime: nextTime, failedTime: (exec.failedTime || 0) + 1 })
                }
                else {
                    this.scheduleMap.delete(id)
                }
            })
        }
    }

    public addSchedule(...schedules: Omit<Schedule, 'id'>[]) {
        const ids: string[] = []
        for (const schedule of schedules) {
            const scheduleId = crypto.randomUUID()
            const scheduleWithId = {
                ...schedule,
                id: scheduleId
            }
            try {
                const nextTime = new CronTime(schedule.corn).getNextDateFrom(new Date()).toMillis()
                this.scheduleMap.set(scheduleId, scheduleWithId)
                this.pendingInsertSchedules.push({ id: scheduleId, nextTime: nextTime })
                ids.push(scheduleId)
            }
            catch (error) {
                console.error('Invalid corn expression:', schedule.corn)
                return
            }
        }
        return ids
    }

    public async execSchedule(schedule: Schedule) {
        console.log(`Executing schedule: ${schedule}`)
        const completion = await this.chatModel.invoke(schedule.prompt)
        console.log(completion)
    }
}

