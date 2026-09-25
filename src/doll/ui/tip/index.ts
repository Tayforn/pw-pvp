// =========================================================
// ЛЯЛЬКА — вхід у тултіпи: слоти, інвентар і панелі імпортують './tip',
// не знаючи, в якому файлі що лежить.
// =========================================================

export { useTip, isCoarsePointer, tipHideAll, type TipAction, type TipApi, type TipContent } from './useTip';
export { TipHost } from './TipHost';
export { ItemTip, instTipContent, instTipCtx, itemTipContent } from './ItemTip';
export { BuffTip } from './BuffTip';
export { GradeName, ItemName } from './ItemName';
