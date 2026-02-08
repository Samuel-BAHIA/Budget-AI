param(
  [string]$Branch = "main",
  [string]$CommitMessage = ""
)

Write-Host "Ajout des changements en attente…" -ForegroundColor Cyan
git add .

if (-not $CommitMessage) {
  $CommitMessage = "Automation commit $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
}

$status = git status --short
if (-not $status) {
  Write-Host "Aucun changement à committer." -ForegroundColor Yellow
  exit 0
}

git commit -m $CommitMessage
git push origin $Branch
