/**
 * Sanitização do texto injetado em terminais via `orq send` / routines.
 *
 * Remove ESC e demais caracteres de controle (exceto \n e \t). Sem isso, uma mensagem poderia
 * conter `\x1b[201~` para "fechar" o bracketed paste e injetar teclas arbitrárias no destino.
 */
export function sanitizeInjectedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f\x80-\x9f]/g, '')
}

const DEFAULT_TEMPLATE =
  '[Mensagem de "{from}" via {cli}] {text}\n(Para responder: {cli} send {from} "<sua resposta>")'

/** Aplica o modelo de mensagem do preset de destino. */
export function formatMessage(template: string, vars: { from: string; text: string; cli: string }): string {
  const tpl = template.trim() === '' ? DEFAULT_TEMPLATE : template
  // Substituição em uma única passada para que "{...}" dentro do texto não seja reinterpretado.
  return tpl.replace(/\{(from|text|cli)\}/g, (_m, key: 'from' | 'text' | 'cli') => vars[key])
}
