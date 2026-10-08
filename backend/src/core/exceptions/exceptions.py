from fastapi import status


class AppException(Exception):
    def __init__(self, detail: str, status_code: int = status.HTTP_400_BAD_REQUEST) -> None:
        self.detail = detail
        self.status_code = status_code
        super().__init__(detail)


class AuthException(AppException):
    """Authentication / authorization related expected errors."""


class RecordedException(AppException):
    """Expected business/data-domain errors we explicitly model."""


class UnrecordedException(AppException):
    """Operational/system errors not directly tied to domain records."""


class OtherAppException(AppException):
    """Fallback app-level custom exception bucket."""


class auth:
    @staticmethod
    def email_already_registered() -> AuthException:
        return AuthException("Email already registered", status.HTTP_400_BAD_REQUEST)

    @staticmethod
    def invalid_credentials() -> AuthException:
        return AuthException("Invalid email or password", status.HTTP_401_UNAUTHORIZED)

    @staticmethod
    def invalid_token() -> AuthException:
        return AuthException("Invalid or expired token", status.HTTP_401_UNAUTHORIZED)

    @staticmethod
    def pending_approval() -> AuthException:
        return AuthException(
            "Your account is pending owner approval. Please contact the owner.",
            status.HTTP_403_FORBIDDEN,
        )

    @staticmethod
    def owner_already_exists() -> AuthException:
        return AuthException("Owner already exists", status.HTTP_400_BAD_REQUEST)

    @staticmethod
    def unauthorized_project_access() -> AuthException:
        return AuthException("Unauthorized project access", status.HTTP_403_FORBIDDEN)

    @staticmethod
    def owner_only_login() -> AuthException:
        return AuthException("This account is not allowed to log in", status.HTTP_403_FORBIDDEN)

    @staticmethod
    def account_revoked() -> AuthException:
        return AuthException("Access to this account has been revoked. Please contact the owner.", status.HTTP_403_FORBIDDEN)


class recorded:
    @staticmethod
    def user_not_found() -> RecordedException:
        return RecordedException("User not found", status.HTTP_404_NOT_FOUND)

    @staticmethod
    def project_not_found() -> RecordedException:
        return RecordedException("Project not found", status.HTTP_404_NOT_FOUND)

    @staticmethod
    def expense_not_found() -> RecordedException:
        return RecordedException("ExpenseLog not found", status.HTTP_404_NOT_FOUND)

    @staticmethod
    def material_not_found() -> RecordedException:
        return RecordedException("MaterialLog not found", status.HTTP_404_NOT_FOUND)

    @staticmethod
    def attendance_not_found() -> RecordedException:
        return RecordedException("AttendanceLog not found", status.HTTP_404_NOT_FOUND)

    @staticmethod
    def work_report_not_found() -> RecordedException:
        return RecordedException("WorkReport not found", status.HTTP_404_NOT_FOUND)

    @staticmethod
    def payment_not_found() -> RecordedException:
        return RecordedException("PaymentLog not found", status.HTTP_404_NOT_FOUND)

    @staticmethod
    def client_not_found() -> RecordedException:
        return RecordedException("Client not found", status.HTTP_404_NOT_FOUND)

    @staticmethod
    def worker_not_found() -> RecordedException:
        return RecordedException("Worker not found", status.HTTP_404_NOT_FOUND)

    @staticmethod
    def attendance_already_exists() -> RecordedException:
        return RecordedException(
            "Attendance already exists for this labour on the selected project and date.",
            status.HTTP_400_BAD_REQUEST,
        )

    @staticmethod
    def record_not_found(model_name: str) -> RecordedException:
        return RecordedException(f"{model_name} not found", status.HTTP_404_NOT_FOUND)


class other:
    @staticmethod
    def app_error(detail: str, status_code: int = status.HTTP_400_BAD_REQUEST) -> OtherAppException:
        return OtherAppException(detail, status_code)
