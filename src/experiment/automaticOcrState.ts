export type SubtitleTransition =
  | {type: "none"; reason: "empty" | "inconclusive" | "unchanged" | "candidate" | "possible-clear"}
  | {type: "display"; text: string}
  | {type: "clear"};

export interface SubtitleObservation {
  text: string;
  confidence: number;
}

export interface SubtitleStabilizerOptions {
  minimumConfidence: number;
  immediateConfidence: number;
  confirmationsRequired: number;
  blankConfirmationsRequired: number;
}

const DEFAULT_OPTIONS: SubtitleStabilizerOptions = {
  minimumConfidence: 55,
  immediateConfidence: 90,
  confirmationsRequired: 2,
  blankConfirmationsRequired: 2
};
const SIMILAR_TEXT_CHANGE_RATIO = 0.2;

export class SubtitleStabilizer {
  private confirmedText = "";
  private candidateText = "";
  private candidateCount = 0;
  private blankCount = 0;

  constructor(private readonly options = DEFAULT_OPTIONS) {}

  observe(observation: SubtitleObservation): SubtitleTransition {
    const text = observation.text.trim();
    if (text.length === 0) return this.observeBlank();
    if (observation.confidence < this.options.minimumConfidence) {
      return {type: "none", reason: "inconclusive"};
    }

    this.blankCount = 0;
    if (text === this.confirmedText) {
      this.resetCandidate();
      return {type: "none", reason: "unchanged"};
    }

    const similarToConfirmed = this.confirmedText.length > 0 &&
      normalizedEditRatio(this.confirmedText, text) < SIMILAR_TEXT_CHANGE_RATIO;
    if (
      observation.confidence >= this.options.immediateConfidence &&
      text.length >= 2 &&
      !similarToConfirmed
    ) {
      return this.confirm(text);
    }

    if (text === this.candidateText) this.candidateCount += 1;
    else {
      this.candidateText = text;
      this.candidateCount = 1;
    }

    if (this.candidateCount >= this.options.confirmationsRequired) return this.confirm(text);
    return {type: "none", reason: "candidate"};
  }

  reset(): void {
    this.confirmedText = "";
    this.blankCount = 0;
    this.resetCandidate();
  }

  needsFollowUp(): boolean {
    return this.candidateCount > 0 || this.blankCount > 0;
  }

  getConfirmedText(): string {
    return this.confirmedText;
  }

  private observeBlank(): SubtitleTransition {
    this.resetCandidate();
    if (this.confirmedText.length === 0) {
      this.blankCount = 0;
      return {type: "none", reason: "empty"};
    }
    this.blankCount += 1;
    if (this.blankCount < this.options.blankConfirmationsRequired) {
      return {type: "none", reason: "possible-clear"};
    }
    this.confirmedText = "";
    this.blankCount = 0;
    return {type: "clear"};
  }

  private confirm(text: string): SubtitleTransition {
    this.confirmedText = text;
    this.blankCount = 0;
    this.resetCandidate();
    return {type: "display", text};
  }

  private resetCandidate(): void {
    this.candidateText = "";
    this.candidateCount = 0;
  }
}

function normalizedEditRatio(left: string, right: string): number {
  const width = Math.max(left.length, right.length);
  if (width === 0) return 0;
  let previous = Array.from({length: right.length + 1}, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length]! / width;
}

export class OcrGeneration {
  private value = 0;

  invalidate(): number {
    this.value += 1;
    return this.value;
  }

  capture(): number {
    return this.value;
  }

  isCurrent(captured: number): boolean {
    return captured === this.value;
  }
}
