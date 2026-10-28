/** The same rule as the server's z.email(), so an address accepted here is accepted there. */
const EMAIL =
  /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

export const isValidEmail = (value: string) => value.length <= 254 && EMAIL.test(value);
