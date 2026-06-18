import {slideTemplateStyles} from './registry.js'

export function templateCss(): string {
  return slideTemplateStyles.join('\n\n')
}
