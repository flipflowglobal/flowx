class VaultClient:
    def __init__(self, addr='http://vault:8200', token=None):
        self.addr = addr
        self.token = token

    def get_secret(self, path, key):
        # Simulate vault access; replace with real hvac calls in production
        return f"secret({path}/{key})"
