import re


def sanitize_text(text: str) -> str:
    """
    Elimina datos sensibles (IPs, credenciales, correos) y limpia conectores
    gramaticales huérfanos para preservar la similitud semántica.
    """
    if not text:
        return ""

    # 1. Eliminar frases con IPv4
    sanitized = re.sub(
        r"\b(?:tiene\s+la\s+|con\s+(?:la\s+)?)?(?:direcci[oó]n\s+)?ip\s*[:=]?\s*\b(?:\d{1,3}\.){3}\d{1,3}\b",
        "",
        text,
        flags=re.IGNORECASE,
    )
    sanitized = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "", sanitized)

    # 2. Enmascarar el VALOR de contraseñas, tokens o llaves explícitas.
    #    Importante: se conserva la palabra ("contraseña", "token") porque es
    #    vocabulario clave para la búsqueda semántica; solo se tacha el secreto.
    secret_word = r"(?:password|passwd|pwd|contrase[nñ]a|clave|secret|token|api_key|apikey|bearer)"
    sanitized = re.sub(
        r"\b(" + secret_word + r")\b(\s*(?::|=|\bes\b)\s*)[\"']?[^\s,;\"']+[\"']?",
        r"\1\2[REDACTADO]",
        sanitized,
        flags=re.IGNORECASE,
    )

    # 3. Eliminar correos electrónicos y su etiqueta previa
    sanitized = re.sub(
        r"\b(?:y\s+)?(?:usuario|user|correo|email|e-mail)\s*[:=]?\s*[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
        "",
        sanitized,
        flags=re.IGNORECASE,
    )
    sanitized = re.sub(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", "", sanitized)

    # 4. Limpiar comas y conjunciones huérfanas tras la eliminación
    sanitized = re.sub(r"\s*,\s*(?:,\s*)+", " ", sanitized)
    sanitized = re.sub(r"\s*,\s*\bpero\b", "", sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r"\s+,", ",", sanitized)
    return " ".join(sanitized.split())