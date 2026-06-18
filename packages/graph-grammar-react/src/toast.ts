// Tiny imperative toast , independent of the React tree so any module can call
// it. Appends a single reused element to <body>.

let flashTimer = 0

export function flash (msg: string) {
  let n = document.getElementById('gg-toast')
  if (!n) {
    n = document.createElement('div')
    n.id = 'gg-toast'
    n.className = 'gg-toast'
    document.body.appendChild(n)
  }
  n.textContent = msg
  n.classList.add('show')
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => n!.classList.remove('show'), 1800)
}
