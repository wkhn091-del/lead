import 'react';

declare module 'react' {
  interface CSSProperties {
    /** Status or channel color read by the .tone-* classes in index.css */
    '--tone'?: string;
  }
}
