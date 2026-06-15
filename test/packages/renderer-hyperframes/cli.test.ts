import {expect} from '#test/expect'

import {buildHyperframesRenderArgs, buildHyperframesValidateArgs} from '../../../packages/renderer-hyperframes/src/cli.js'

describe('hyperframes cli', () => {
  it('builds validate args with the default command', () => {
    expect(buildHyperframesValidateArgs({projectDir: '/tmp/render'})).to.deep.equal(['hyperframes', 'validate', '/tmp/render'])
  })

  it('builds render args with a custom command prefix', () => {
    expect(
      buildHyperframesRenderArgs({
        command: ['npx', 'hyperframes'],
        outputPath: '/tmp/output.mp4',
        projectDir: '/tmp/render',
      }),
    ).to.deep.equal(['npx', 'hyperframes', 'render', '/tmp/render', '--output', '/tmp/output.mp4'])
  })
})
