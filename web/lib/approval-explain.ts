/**
 * 把 Hermes 给的英文"为什么拦你"翻成人话：这条命令要做什么、会造成什么后果。
 *
 * description 来自 Hermes 的审批事件，取值是 tools/approval_detection.py 里
 * DANGEROUS_PATTERNS / HARDLINE_PATTERNS 的规则名（有限集合，可能用 "; " 串了多条）。
 * 这里按规则名归类成中文说明；没归类到的一律走兜底，不猜、不编。
 */

export type Explanation = {
  /** 这条命令要做什么（一句话） */
  goal: string
  /** 做下去可能出什么事（一句话） */
  risk: string
  /** 2 = 可能不可恢复（删数据 / 写盘 / 执行外部代码），1 = 影响可用性或配置 */
  danger: 1 | 2
}

type Rule = { test: RegExp; goal: string; risk: string; danger: 1 | 2 }

const RULES: Rule[] = [
  {
    test: /disk|mkfs|format|dd to raw|block device|partition|cipher \/w/i,
    goal: '直接操作磁盘',
    risk: '磁盘上的数据可能被整块抹掉，无法恢复',
    danger: 2,
  },
  {
    test: /SQL (DROP|TRUNCATE)|DELETE without WHERE/i,
    goal: '删除数据库里的数据',
    risk: '数据会永久丢失，没有后悔的机会',
    danger: 2,
  },
  {
    test: /pipe remote content|execute remote content|remote script|decoded content to shell|command obfuscation|Invoke-Expression/i,
    goal: '把从网上取回的内容当程序运行',
    risk: '跑的是什么完全不可控，等于把服务器交给外面的人',
    danger: 2,
  },
  {
    test: /sensitive credential|SSH keys|Hermes secrets|shell-rc/i,
    goal: '读写密钥或登录凭据文件',
    risk: '密钥可能被读取或替换，等于交出服务器的钥匙',
    danger: 2,
  },
  {
    test: /recursive delete|delete in root path|find -delete|find -exec|xargs with rm|destructive delete|git clean/i,
    goal: '删除文件或目录',
    risk: '删掉的东西找不回来；如果目标是重要目录，可能连数据一起没了',
    danger: 2,
  },
  {
    test: /world\/other-writable|grant everyone|recursive chown/i,
    goal: '放宽文件权限',
    risk: '之后任何程序都能改或执行这些文件，容易被塞进坏东西',
    danger: 1,
  },
  {
    test: /stop\/restart system service|force kill|kill all processes|killall|force stop service|kill hermes|kill process|self-termination/i,
    goal: '停止正在运行的服务或程序',
    risk: '服务会中断，网站或接口可能立刻打不开',
    danger: 1,
  },
  {
    test: /git force push|git reset --hard|git branch force delete/i,
    goal: '覆盖远端分支或丢弃本地改动',
    risk: '别人已经拉走的代码、以及你还没提交的改动会丢',
    danger: 1,
  },
  {
    test: /overwrite system config|in-place edit of system config|copy\/move file into system config|boot configuration|registry/i,
    goal: '改动系统配置',
    risk: '配置改坏后服务可能起不来，排查很费时间',
    danger: 1,
  },
  {
    test: /overwrite project env|in-place edit of Hermes|hermes update|Hermes config/i,
    goal: '改动 Hermes 自身或项目的配置文件',
    risk: '可能重启网关、打断正在跑的对话，或覆盖掉配置里的密钥',
    danger: 1,
  },
  {
    test: /docker|podman/i,
    goal: '重启或停止容器',
    risk: '容器里的服务会中断；若是远程 Docker，影响的是别的机器',
    danger: 1,
  },
  {
    test: /execute_code|script execution/i,
    goal: '运行一段脚本',
    risk: '脚本里面还能做别的操作，不一定都经过检查',
    danger: 1,
  },
]

/** 兜底：有条目但没被归类时用；宁可说得笼统，也不编具体后果。 */
const FALLBACK: Explanation = {
  goal: '执行一条被 Hermes 判定为有风险的操作',
  risk: 'Hermes 认为这条命令会做危险的事，点允许之前请看清下面的命令原文',
  danger: 1,
}

export function explainApproval(description: string): Explanation {
  const parts = (description || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  const hits = parts
    .map((p) => RULES.find((r) => r.test.test(p)))
    .filter((r): r is Rule => Boolean(r))
  if (!hits.length) return FALLBACK

  const goal = Array.from(new Set(hits.map((h) => h.goal))).join('；')
  const top = hits.reduce((a, b) => (b.danger > a.danger ? b : a))
  return { goal, risk: top.risk, danger: top.danger }
}
