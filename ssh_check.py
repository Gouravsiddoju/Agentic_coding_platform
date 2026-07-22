import paramiko
import sys

def ssh_command(ip, user, password, command):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(ip, username=user, password=password, timeout=10)
        stdin, stdout, stderr = client.exec_command(command)
        print("STDOUT:")
        print(stdout.read().decode())
        err = stderr.read().decode()
        if err:
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
    ssh_command(ip, user, password, "ps aux | grep ollama; echo '---'; OLLAMA_HOST=127.0.0.1:8006 ollama run OptGPT-4:latest 'hello' 2>&1")
