import paramiko
import sys

def ssh_command(ip, user, password, command):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(ip, username=user, password=password, timeout=10)
        stdin, stdout, stderr = client.exec_command(command)
        out = stdout.read().decode()
        err = stderr.read().decode()
        print("STDOUT:")
        print(out)
        print("STDERR:")
        print(err)
    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    ip = "192.168.1.117"
    user = "to-00090"
    password = "Siddarth@90"
    cmds = [
        "df -h /usr/share/ollama"
    ]
    ssh_command(ip, user, password, " ; echo '---' ; ".join(cmds))
