#!/bin/bash
# เปิดพอร์ตของเกมผ่านไฟร์วอลล์ NINESYNC-INGRESS (สร้างโดย 9sync-docker-firewall) แบบถาวร
# ไม่แก้ไฟล์ของ 9sync: ติดตั้ง service แยก ที่รันต่อจากของ 9sync ทุกครั้งแล้วแทรกกฎให้ใหม่
# ใช้: sudo bash deploy/install-firewall-rule.sh [พอร์ตสาธารณะ ค่าเริ่มต้น 8080]
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "ต้องรันด้วย sudo"; exit 1; }
PORT="${1:-8080}"
[[ "$PORT" =~ ^[0-9]+$ ]] || { echo "พอร์ตต้องเป็นตัวเลข"; exit 1; }

cat > /usr/local/sbin/werewolf-docker-firewall <<'EOF'
#!/bin/bash
# แทรกกฎอนุญาตพอร์ตสาธารณะ $1 (ไป container พอร์ต 80) ไว้ก่อนกฎ DROP ใน NINESYNC-INGRESS
set -eu
PORT="${1:-8080}"
iface=$(ip -4 route show default | awk 'NR==1 {print $5}')
[[ -n "$iface" ]]
for tool in iptables ip6tables; do
  "$tool" -w -n -L NINESYNC-INGRESS >/dev/null 2>&1 || continue
  rule=(-i "$iface" -p tcp -m tcp --dport 80 -m conntrack --ctorigdstport "$PORT" -j RETURN)
  if "$tool" -w -C NINESYNC-INGRESS "${rule[@]}" 2>/dev/null; then continue; fi
  pos=$("$tool" -w -n -L NINESYNC-INGRESS --line-numbers | awk '$2=="DROP"{print $1; exit}')
  "$tool" -w -I NINESYNC-INGRESS "${pos:-1}" "${rule[@]}"
done
EOF
chmod 755 /usr/local/sbin/werewolf-docker-firewall

cat > /etc/systemd/system/werewolf-firewall.service <<EOF
[Unit]
Description=Allow Werewolf port ${PORT} through the 9sync Docker ingress firewall
After=docker.service 9sync-docker-firewall.service
Wants=9sync-docker-firewall.service
PartOf=9sync-docker-firewall.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/werewolf-docker-firewall ${PORT}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable werewolf-firewall.service >/dev/null
systemctl restart werewolf-firewall.service
echo "✓ ติดตั้งแล้ว กฎปัจจุบัน:"
iptables -w -S NINESYNC-INGRESS
