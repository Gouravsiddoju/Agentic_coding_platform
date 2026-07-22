import paramiko

def ssh_command(ip, user, password, command):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(ip, username=user, password=password, timeout=10)
        stdin, stdout, stderr = client.exec_command(command)
        print("STDOUT:")
        print(stdout.read().decode())
    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    ip = "192.168.1.117"
    user = "to-00090"
    password = "Siddarth@90"
    # Check Ollama logs, memory info, and disk space
    cmds = [
        "free -h",
        "nvidia-smi",
        "journalctl -u ollama -n 50 --no-pager"
    ]
    ssh_command(ip, user, password, " ; echo '---' ; ".join(cmds))
