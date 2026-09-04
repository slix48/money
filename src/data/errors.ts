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
