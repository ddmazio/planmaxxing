/** Aviso com “Desfazer”: quem conclui algo chama undoable(); o Shell mostra o aviso por alguns segundos. */
export interface UndoMsg { id: number; msg: string; undo: () => unknown }
let seq = 0
export function undoable(msg: string, undo: () => unknown) {
  window.dispatchEvent(new CustomEvent<UndoMsg>('tf-undo', { detail: { id: ++seq, msg, undo } }))
}
