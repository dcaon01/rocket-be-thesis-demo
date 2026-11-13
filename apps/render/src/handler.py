"""Renders the HTML documents of the core Lambda into other formats: today only PDF, with WeasyPrint."""

import base64  # CI trigger

from weasyprint import HTML, default_url_fetcher

SUPPORTED_FORMATS = {"pdf"}

# Only public resources: file:// would read the Lambda's own files and environment, http:// internal endpoints.
ALLOWED_SCHEMES = ("https://", "data:")


def _fetch(url, *args, **kwargs):
    """Fetches a resource of the document, refusing anything but https and inline data."""
    if not url.startswith(ALLOWED_SCHEMES):
        raise ValueError(f"Blocked resource: {url}")
    return default_url_fetcher(url, *args, **kwargs)


def handler(event, context):
    """
    Renders an HTML document. Remote resources (fonts, images) are fetched over https only, with WeasyPrint's
    10-second timeout; the bundled fonts come through fontconfig, not through the fetcher.
    :param event: {"format": "pdf", "html": "<the document>"}.
    :return: {"content": "<the rendered document, base64>"}.
    :raises ValueError: if the format is not supported or the HTML is missing.
    """
    output_format = event.get("format")
    if output_format not in SUPPORTED_FORMATS:
        raise ValueError(f"Unsupported format: {output_format}")
    html = event.get("html")
    if not html:
        raise ValueError("The HTML to render is missing.")

    pdf = HTML(string=html, url_fetcher=_fetch).write_pdf()
    return {"content": base64.b64encode(pdf).decode("ascii")}
