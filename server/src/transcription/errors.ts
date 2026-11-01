/** A transcription problem with a message that can be shown on the timeline as it is. */
export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionError';
  }
}
