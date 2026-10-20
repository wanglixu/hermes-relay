/** 技能菜单的模糊匹配：关键词 4 个字以上允许 1 个拼错的字符（i-hava → i-have）。
 *  从 composer.tsx 拆出来，单独一个纯函数好测。
 */
// 模糊包含匹配：支持当关键词长度 >= 4 时，允许 1 个字符的拼写误差（如 i-hava 匹配 i-have）
export function fuzzyMatch(query: string, target: string): boolean {
  if (target.includes(query)) return true
  if (query.length < 4) return false
  const qLen = query.length
  for (let i = 0; i <= target.length - qLen; i++) {
    const sub = target.slice(i, i + qLen)
    let diff = 0
    for (let j = 0; j < qLen; j++) {
      if (sub[j] !== query[j]) {
        diff++
        if (diff > 1) break
      }
    }
    if (diff <= 1) return true
  }
  return false
}

