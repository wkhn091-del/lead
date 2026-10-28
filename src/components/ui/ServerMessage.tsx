import { Fragment } from 'react';

/**
 * A message from the server, with its left-to-right runs (a setting's name, an address: the server wraps them in
 * ⁦…⁩) kept whole and left to right, so an address like "https://omek-leads.vercel.app" never breaks at its hyphen.
 */
export function ServerMessage({ text }: { text: string }) {
  const parts = text.split(/⁦([^⁩]*)⁩/);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 ? (
          <bdi key={index} dir="ltr" className="font-medium whitespace-nowrap">
            {part}
          </bdi>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
