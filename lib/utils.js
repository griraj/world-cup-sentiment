const TEAMS = {
  Argentina: ['argentina', 'messi', 'albiceleste', 'scaloni', 'dibu', 'arg'],
  Brazil: ['brazil', 'brasil', 'neymar', 'selecao', 'samba', 'bra'],
  France: ['france', 'mbappe', 'griezmann', 'les bleus', 'fra'],
  England: ['england', 'kane', 'three lions', 'southgate', 'eng'],
  Germany: ['germany', 'deutschland', 'muller', 'neuer', 'ger'],
  Spain: ['spain', 'pedri', 'morata', 'la roja', 'esp'],
  Portugal: ['portugal', 'ronaldo', 'cr7', 'por'],
  Morocco: ['morocco', 'hakimi', 'atlas lions', 'mar'],
  Japan: ['japan', 'samurai blue', 'jpn'],
  USA: ['usa', 'usmnt', 'pulisic'],
}

export function detectTeam(text) {
  const lower = text.toLowerCase()
  for (const [team, keywords] of Object.entries(TEAMS)) {
    if (keywords.some(k => lower.includes(k))) return team
  }
  return null
}

export function cleanText(text) {
  return text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@\w+/g, ' ')
    .replace(/#(\w+)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512)
}
