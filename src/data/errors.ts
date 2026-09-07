export class NotFoundError extends Error {
  constructor(message = "Record not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class UnauthenticatedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class ValidationError extends Error {
  constructor(message = "Invalid request") {
    super(message);
    this.name = "ValidationError";
  }
}

export class ExportCapacityError extends Error {
  constructor(message = "Background data export required") {
    super(message);
    this.name = "ExportCapacityError";
  }
}

export class PasskeyVerificationError extends Error {
  constructor(message = "Passkey verification failed") {
    super(message);
    this.name = "PasskeyVerificationError";
  }
}

export class ReauthenticationRequiredError extends Error {
  constructor(message = "Recent multi-factor authentication required") {
    super(message);
    this.name = "ReauthenticationRequiredError";
  }
}

export class AccountDeletionBlockedError extends Error {
  constructor(message = "A connected provider could not be revoked") {
    super(message);
    this.name = "AccountDeletionBlockedError";
  }
}
