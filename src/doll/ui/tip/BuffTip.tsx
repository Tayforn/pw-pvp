// =========================================================
// ЛЯЛЬКА — тіло тултіпа бафа: назва + рядки buildBuffTipModel (рівень,
// параметри, опис ефектів останнім). Лише React-вузли.
// =========================================================

export function BuffTip({ model }: { model: { name: string; lines: string[] } }) {
  return (
    <div className="doll-tip-buff">
      <div className="doll-tip-name">{model.name}</div>
      {model.lines.map((line, i) => (
        <div className="doll-tip-line" key={i}>{line}</div>
      ))}
    </div>
  );
}
