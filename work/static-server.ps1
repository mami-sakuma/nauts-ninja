param(
  [int] $Port = 5174
)

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$prefix = "http://127.0.0.1:$Port/"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)
$listener.Start()

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.png' = 'image/png'
  '.jpg' = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'
}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $path = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
  if ([string]::IsNullOrWhiteSpace($path)) {
    $path = 'index.html'
  }

  $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $path))
  if (-not $fullPath.StartsWith($root)) {
    $context.Response.StatusCode = 403
    $context.Response.Close()
    continue
  }

  if (-not [System.IO.File]::Exists($fullPath)) {
    $context.Response.StatusCode = 404
    $context.Response.Close()
    continue
  }

  $bytes = [System.IO.File]::ReadAllBytes($fullPath)
  $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
  $context.Response.ContentType = $types[$extension]
  if (-not $context.Response.ContentType) {
    $context.Response.ContentType = 'application/octet-stream'
  }
  $context.Response.ContentLength64 = $bytes.Length
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $context.Response.Close()
}
