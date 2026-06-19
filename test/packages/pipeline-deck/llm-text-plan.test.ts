import {expect} from '#test/expect'

import type {GenerateObjectRequest, GenerateTextRequest, LLMClient, LLMEvent, StreamTextRequest} from '../../../packages/llm/src/index.js'
import {createLLMTextDeckProjectPlan} from '../../../packages/pipeline-deck/src/planning/llm-text-plan.js'
import {createTextDeckProjectPlanFromLLM} from '../../../packages/pipeline-deck/src/planning/text-plan-builder.js'
import {findDeckTemplateManifestEntry, validateSlideAgainstTemplateManifest} from '../../../packages/renderer-deck/src/deck/templates/manifest.js'

describe('Deck Explainer LLM text planning', () => {
  it('asks the LLM to preserve source code examples as code slides', async () => {
    let capturedRequest: GenerateObjectRequest<unknown> | undefined
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        capturedRequest = request as GenerateObjectRequest<unknown>

        return {
          object: {
            slides: [
              {
                points: ['Pods are the smallest deployable unit.'],
                speakerNote: 'Start with what a Pod represents in Kubernetes.',
                title: 'Kubernetes Pods',
                type: 'hero',
              },
              {
                code: {
                  language: 'sh',
                  text: 'kubectl apply -f https://k8s.io/examples/pods/simple-pod.yaml',
                },
                points: ['Apply a Pod manifest with kubectl.'],
                speakerNote: 'This command applies the example Pod manifest with kubectl.',
                title: 'Create a Pod',
                type: 'code',
              },
              {
                points: ['Use workload resources for ongoing management.'],
                speakerNote: 'The takeaway is to manage Pods through controllers for real workloads.',
                title: 'Key Takeaway',
                type: 'summary',
              },
            ],
            summary: 'Pods are Kubernetes deployable units and can be created from manifests.',
            theme: 'tech-gradient',
            title: 'Kubernetes Pods',
          } as T,
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(
      llm,
      '/tmp/pods.md',
      [
        '# Using Pods',
        '',
        'The following is an example of a Pod which consists of a container running nginx.',
        '',
        '{{% code_sample file="pods/simple-pod.yaml" %}}',
        '',
        'To create the Pod shown above, run the following command:',
        '',
        '```sh',
        'kubectl apply -f https://k8s.io/examples/pods/simple-pod.yaml',
        '```',
      ].join('\n'),
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 90,
        language: 'en-US',
        maxSlideCharacters: 260,
        requiredSlideTypes: ['hero', 'process', 'code', 'summary'],
        slideSeconds: 22,
      },
    )

    const message = capturedRequest?.messages?.[0]
    const payload = JSON.parse(typeof message?.content === 'string' ? message.content : '') as {
      instructions: string[]
    }

    expect(plan.deck.slides.map((slide) => slide.type)).to.include('code')
    expect(payload.instructions.join('\n')).to.include('code_sample references')
    expect(payload.instructions.join('\n')).to.include('include at least one code slide')
    expect(payload.instructions.join('\n')).to.include('preserve the executable command')
    expect(payload.instructions.join('\n')).to.include('end with a summary slide')
    expect(payload.target.requiredSlideTypes).to.deep.equal(['hero', 'process', 'code', 'summary'])
  })

  it('repairs visible point text to template character limits before quality validation', () => {
    const plan = createTextDeckProjectPlanFromLLM(
      '/tmp/provider-hardening.md',
      'Provider certification needs stable failures, costs, retries, and traces.',
      {
        slides: [
          {
            points: ['Provider checks'],
            speakerNote: 'Open with the provider hardening target.',
            title: 'Providers',
            type: 'hero',
          },
          {
            points: ['把失败信息成本重试trace都稳定到可认证状态'],
            speakerNote: 'Explain the single certification idea.',
            title: 'Certification',
            type: 'one-big-idea',
          },
          {
            points: [
              'Capture structured provider failures before retry',
              'Record cost and usage beside each trace',
              'Gate certification on stable retry output',
            ],
            speakerNote: 'Walk through the provider certification process.',
            title: 'Process',
            type: 'process',
          },
          {
            points: [
              'Failures are readable and traceable',
              'Cost stays visible during reruns',
              'Retries produce certified artifacts',
            ],
            speakerNote: 'Summarize the provider hardening outcome.',
            title: 'Summary',
            type: 'summary',
          },
        ],
        summary: 'Provider certification stabilizes failures, cost, retries, and traces.',
        title: 'Provider Hardening',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 90,
        language: 'zh-CN',
        maxSlideCharacters: 260,
        slideSeconds: 22,
      },
    )

    for (const slide of plan.deck.slides) {
      const pointLimit = findDeckTemplateManifestEntry(slide.type).limits.point_chars

      if (pointLimit !== undefined) {
        expect(slide.points.every((point) => point.length <= pointLimit)).to.equal(true)
      }

      expect(validateSlideAgainstTemplateManifest(slide)).to.have.length(0)
    }
  })
})
