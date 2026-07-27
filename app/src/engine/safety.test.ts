import { describe, expect, it } from 'vitest'
import { buildSafetyTriageInput, evaluateSafetyTriage, type SafetyTriageInput } from './safety'

describe('deterministic safety triage', () => {
  it('returns a non-reassuring no-match result for empty answers', () => {
    const result = evaluateSafetyTriage({})

    expect(result.urgency).toBe('none')
    expect(result.reasons).toEqual([])
    expect(result.sourceIds).toEqual([])
    expect(result.caveat).toContain('no match does not mean')
  })

  it('routes explicitly selected self-harm thoughts to emergency care', () => {
    const result = evaluateSafetyTriage({
      mentalHealth: { thoughtsOfSelfHarm: true },
    })

    expect(result.urgency).toBe('emergency')
    expect(result.reasons.map((item) => item.id)).toEqual(['self-harm-thoughts'])
    expect(result.action).toContain('emergency')
    expect(result.sourceIds).toContain('NIMH_SELF_HARM_CRISIS')
  })

  it.each([
    ['dizziness', { dizziness: true }],
    ['lightheadedness', { lightheadedness: true }],
    ['chest pain', { chestPain: true }],
    ['shortness of breath', { shortnessOfBreath: true }],
  ])(
    'routes the complete heavy-bleeding emergency combination with %s',
    (_label, systemicSymptom) => {
      const result = evaluateSafetyTriage({
        bleeding: {
          soakedProductsPerHour: 1,
          consecutiveHours: 2,
          ...systemicSymptom,
        },
      })

      expect(result.urgency).toBe('emergency')
      expect(result.reasons[0]?.id).toBe(
        'very-heavy-bleeding-with-systemic-symptoms',
      )
      expect(result.sourceIds).toEqual(['ACOG_ABNORMAL_UTERINE_BLEEDING'])
    },
  )

  it.each([
    {
      name: 'rate below threshold',
      bleeding: {
        soakedProductsPerHour: 0.99,
        consecutiveHours: 2,
        dizziness: true,
      },
    },
    {
      name: 'duration below threshold',
      bleeding: {
        soakedProductsPerHour: 1,
        consecutiveHours: 1.99,
        dizziness: true,
      },
    },
    {
      name: 'systemic symptom not selected',
      bleeding: { soakedProductsPerHour: 1, consecutiveHours: 2 },
      expected: 'same-day',
    },
    {
      name: 'rate missing',
      bleeding: { consecutiveHours: 2, dizziness: true },
    },
    {
      name: 'duration missing',
      bleeding: { soakedProductsPerHour: 1, dizziness: true },
    },
  ])(
    'does not apply the emergency bleeding rule when $name',
    ({ bleeding, expected = 'none' }) => {
      expect(evaluateSafetyTriage({ bleeding }).urgency).toBe(expected)
    },
  )

  it.each([
    ['fainting', { fainting: true }],
    ['shoulder pain', { shoulderPain: true }],
    ['sudden severe pelvic pain', { suddenSeverePelvicPain: true }],
  ])(
    'routes possible pregnancy with bleeding and %s to emergency care',
    (_label, dangerSign) => {
      const result = evaluateSafetyTriage({
        pregnancy: {
          status: 'possible',
          vaginalBleeding: true,
          ...dangerSign,
        },
      })

      expect(result.urgency).toBe('emergency')
      expect(result.reasons[0]?.id).toBe('possible-pregnancy-emergency-signs')
      expect(result.sourceIds).toEqual([
        'ACOG_BLEEDING_DURING_PREGNANCY',
        'ACOG_ECTOPIC_PREGNANCY',
      ])
    },
  )

  it('also applies the pregnancy emergency rule to a confirmed pregnancy with pelvic pain', () => {
    const result = evaluateSafetyTriage({
      pregnancy: {
        status: 'confirmed',
        pelvicPain: true,
        fainting: true,
      },
    })

    expect(result.urgency).toBe('emergency')
    expect(result.reasons[0]?.id).toBe('possible-pregnancy-emergency-signs')
  })

  it.each([
    {
      name: 'pregnancy status is absent',
      pregnancy: { vaginalBleeding: true, fainting: true },
    },
    {
      name: 'neither bleeding nor pelvic pain is selected',
      pregnancy: { status: 'possible' as const, shoulderPain: true },
    },
    {
      name: 'the danger sign is absent',
      pregnancy: { status: 'possible' as const, vaginalBleeding: true },
      expected: 'same-day',
    },
  ])(
    'does not apply the pregnancy emergency rule when $name',
    ({ pregnancy, expected = 'none' }) => {
      expect(
        evaluateSafetyTriage({
          pregnancy: pregnancy as SafetyTriageInput['pregnancy'],
        }).urgency,
      ).toBe(expected)
    },
  )

  it.each([
    [
      'possible pregnancy bleeding',
      {
        pregnancy: { status: 'possible' as const, vaginalBleeding: true },
      },
      'possible-pregnancy-bleeding-or-pain',
    ],
    [
      'possible pregnancy pelvic pain',
      { pregnancy: { status: 'possible' as const, pelvicPain: true } },
      'possible-pregnancy-bleeding-or-pain',
    ],
    [
      'very heavy bleeding without a systemic symptom',
      {
        bleeding: { soakedProductsPerHour: 1, consecutiveHours: 2 },
      },
      'very-heavy-bleeding',
    ],
    [
      'sudden severe pelvic pain',
      { pelvicPain: { suddenSevere: true } },
      'sudden-severe-pelvic-pain',
    ],
    [
      'bleeding after menopause',
      { bleeding: { afterMenopause: true } },
      'bleeding-after-menopause',
    ],
  ])('routes %s to same-day care', (_label, input, reasonId) => {
    const result = evaluateSafetyTriage(input)

    expect(result.urgency).toBe('same-day')
    expect(result.reasons[0]?.id).toBe(reasonId)
  })

  it.each([
    [
      'bleeding between periods',
      { bleeding: { betweenPeriods: true } },
      'bleeding-between-periods',
    ],
    [
      'bleeding longer than seven days',
      { bleeding: { durationDays: 8 } },
      'bleeding-longer-than-seven-days',
    ],
    [
      'persistent or recurring pelvic pain',
      { pelvicPain: { persistentOrRecurring: true } },
      'persistent-or-recurring-pelvic-pain',
    ],
  ])('routes %s to routine follow-up', (_label, input, reasonId) => {
    const result = evaluateSafetyTriage(input)

    expect(result.urgency).toBe('routine')
    expect(result.reasons[0]?.id).toBe(reasonId)
  })

  it('does not apply the duration rule at exactly seven days', () => {
    expect(
      evaluateSafetyTriage({ bleeding: { durationDays: 7 } }).urgency,
    ).toBe('none')
  })

  it('returns every reason at the highest matched urgency without lower-priority clutter', () => {
    const result = evaluateSafetyTriage({
      mentalHealth: { thoughtsOfSelfHarm: true },
      bleeding: {
        soakedProductsPerHour: 2,
        consecutiveHours: 3,
        dizziness: true,
        betweenPeriods: true,
      },
      pelvicPain: { persistentOrRecurring: true },
    })

    expect(result.urgency).toBe('emergency')
    expect(result.reasons.map((item) => item.id)).toEqual([
      'self-harm-thoughts',
      'very-heavy-bleeding-with-systemic-symptoms',
    ])
    expect(result.reasons.some((item) => item.id === 'bleeding-between-periods')).toBe(
      false,
    )
  })

  it('deduplicates source IDs across multiple matching reasons', () => {
    const result = evaluateSafetyTriage({
      bleeding: { betweenPeriods: true, durationDays: 9 },
    })

    expect(result.urgency).toBe('routine')
    expect(result.reasons).toHaveLength(2)
    expect(result.sourceIds).toEqual(['ACOG_ABNORMAL_UTERINE_BLEEDING'])
  })

  it('never emits diagnostic wording', () => {
    const cases: SafetyTriageInput[] = [
      {},
      { mentalHealth: { thoughtsOfSelfHarm: true } },
      {
        pregnancy: {
          status: 'possible',
          vaginalBleeding: true,
          shoulderPain: true,
        },
      },
      {
        bleeding: {
          soakedProductsPerHour: 1,
          consecutiveHours: 2,
          chestPain: true,
        },
      },
    ]

    for (const input of cases) {
      const serialized = JSON.stringify(evaluateSafetyTriage(input)).toLowerCase()
      expect(serialized).not.toContain('you have')
      expect(serialized).not.toContain('diagnosis:')
      expect(serialized).not.toContain('ectopic pregnancy')
    }
  })
})

describe('buildSafetyTriageInput (DailyLog.safetyCheckIn adapter)', () => {
  it('maps the combined heavy-soaking checkbox to both engine threshold fields', () => {
    const input = buildSafetyTriageInput({ heavySoakingTwoHoursPlus: true })
    expect(input.bleeding?.soakedProductsPerHour).toBe(1)
    expect(input.bleeding?.consecutiveHours).toBe(2)
    expect(evaluateSafetyTriage(input).urgency).toBe('same-day')
  })

  it('leaves heavy-bleeding fields unset when the checkbox is off, even with other flags on', () => {
    const input = buildSafetyTriageInput({ dizziness: true })
    expect(input.bleeding?.soakedProductsPerHour).toBeUndefined()
    expect(input.bleeding?.consecutiveHours).toBeUndefined()
    // Dizziness alone (no heavy-bleeding threshold) matches no rule.
    expect(evaluateSafetyTriage(input).urgency).toBe('none')
  })

  it('passes through pregnancy status and duration-days context', () => {
    const input = buildSafetyTriageInput(
      { pregnancyVaginalBleeding: true },
      { pregnancyStatus: 'possible', bleedingDurationDays: 9 },
    )
    expect(input.pregnancy?.status).toBe('possible')
    expect(input.bleeding?.durationDays).toBe(9)
    expect(evaluateSafetyTriage(input).urgency).toBe('same-day')
  })

  it('returns an empty-but-contextual input for an undefined check-in', () => {
    const input = buildSafetyTriageInput(undefined, { pregnancyStatus: 'confirmed' })
    expect(evaluateSafetyTriage(input).urgency).toBe('none')
    expect(input.pregnancy?.status).toBe('confirmed')
  })
})
