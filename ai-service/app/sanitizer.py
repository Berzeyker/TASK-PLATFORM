import re


def sanitize_text(text: str) -> str:
    """
    Elimina direcciones IP internas, credenciales explícitas y correos personales
    antes de almacenar vectores o enviar texto a proveedores LLM externos.
    """
    if not text:
        return ""

    # 1. Redactar direcciones IPv4 (ej. 192.168.10.25 -> [REDACTED_IP])
    sanitized = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "[REDACTED_IP]", text)

    # 2. Redactar contraseñas, secretos, API keys o tokens Bearer
    sanitized = re.sub(
        r'(password|passwd|pwd|secret|token|api_key|apikey|bearer)\s*[:=]\s*["\']?[^\s"\']+["\']?',
        r"\1: [REDACTED_SECRET]",
        sanitized,
        flags=re.IGNORECASE,
    )

    # 3. Redactar correos electrónicos
    sanitized = re.sub(
        r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
        "[REDACTED_EMAIL]",
        sanitized,
    )

    return sanitized