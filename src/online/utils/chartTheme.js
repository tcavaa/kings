// One look for King Online's recharts line charts (score progression, the
// in-game score chart, the season race), on their dark panels.

export const CHART_COLOURS = ['#d7fa52', '#b8c5a5', '#789e98', '#e0a458', '#c98fd1']

const tick = { fontSize: 11 }

export const gridProps = { strokeDasharray: '3 3', stroke: 'rgba(151,176,162,0.12)' }
export const axisProps = { stroke: 'rgba(225,233,225,0.6)', tick }
export const zeroLineProps = { y: 0, stroke: 'rgba(151,176,162,0.5)', strokeDasharray: '3 3' }
export const tooltipProps = {
  contentStyle: {
    background: '#20251f',
    border: '1px solid rgba(151,176,162,0.4)',
    borderRadius: 2,
    fontSize: 12,
    color: '#eeeae1',
  },
  labelStyle: { color: '#d7fa52' },
}
export const legendProps = { wrapperStyle: { fontSize: 11, color: '#eeeae1' } }
export const lineProps = { strokeWidth: 2.4, dot: false, activeDot: { r: 4 } }
