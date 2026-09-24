// The phase-shifted wave packet from the original Gum CLI landing page.
<Svg width={px(500)} height={px(100)}>
  <Graph width="fill" height="fill" xlim={[-4 * pi, 4 * pi]} ylim={[-1, 1]}>
    {linspace(0, pi, 10).map((phase) => (
      <SymSpline
        fy={(x) => cos(x - phase) * exp(-0.05 * x * x)}
        xlim={[-4 * pi, 4 * pi]}
        samples={101}
        stroke={interp(red, blue, phase / pi)}
        stroke-width={px(2)}
      />
    ))}
  </Graph>
</Svg>
