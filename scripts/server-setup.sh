#!/bin/bash
# Setup inicial do servidor — executar uma única vez como root
set -e

echo "🚀 Configurando servidor para o projeto mids..."

# 1. Atualizar sistema
apt-get update -y && apt-get upgrade -y
apt-get install -y curl wget git

# 2. Instalar Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

# 3. Inicializar Docker Swarm
docker swarm init

# 4. Criar rede overlay para Traefik
docker network create --driver overlay --attachable traefik-public

# 5. Criar diretório da aplicação
mkdir -p /opt/mids

# 6. Gerar SSH key para GitHub Actions
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "github-actions-mids"
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

echo ""
echo "✅ Servidor configurado!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 PRÓXIMOS PASSOS:"
echo ""
echo "1. Copie a chave privada abaixo e adicione como"
echo "   SECRET no GitHub (SERVER_SSH_KEY):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cat ~/.ssh/github_deploy
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "2. Configure os GitHub Secrets:"
echo "   SERVER_HOST         → IP desta VPS"
echo "   SERVER_SSH_KEY      → chave acima"
echo "   DB_PASSWORD         → senha forte para o banco"
echo "   KOMMO_SUBDOMAIN     → seu subdomínio Kommo"
echo "   KOMMO_ACCESS_TOKEN  → token Kommo"
echo "   TENFRONT_BASE_URL   → URL TenFront"
echo "   TENFRONT_BEARER_TOKEN"
echo "   TENFRONT_CONSUMER_KEY"
echo "   TENFRONT_CONSUMER_SECRET"
echo "   CRON_SCHEDULE       → ex: 0 8 * * *"
echo ""
echo "3. No seu PC local, copie a infra para o servidor:"
echo "   scp docker-compose.infra.yml root@IP_DA_VPS:/opt/mids/"
echo ""
echo "4. Volte ao servidor e suba a infra:"
echo "   docker stack deploy -c /opt/mids/docker-compose.infra.yml infra"
echo ""
echo "5. Acesse o Portainer em: http://IP_DA_VPS:9000"
echo ""
echo "6. Faça git push para a branch main — o deploy"
echo "   acontece automaticamente!"
