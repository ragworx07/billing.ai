import os
import sys
from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

SCOPES = ['https://www.googleapis.com/auth/drive']
CLIENT_SECRETS_FILE = 'client_secret.json'
TOKEN_FILE = 'gdrive_token.json'

def authenticate():
    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print("Refreshing existing token...")
            creds.refresh(Request())
        else:
            if not os.path.exists(CLIENT_SECRETS_FILE):
                # Search for any client_secret*.json
                candidates = list(Path('.').glob('client_secret*.json')) + list(Path('..').glob('client_secret*.json'))
                if candidates:
                    chosen = candidates[0]
                    print(f"Using found client secret: {chosen}")
                    flow = InstalledAppFlow.from_client_secrets_file(str(chosen), SCOPES)
                else:
                    print(f"Error: '{CLIENT_SECRETS_FILE}' not found.")
                    print("Please download your OAuth Client ID JSON from Google Cloud Console and save it as client_secret.json")
                    sys.exit(1)
            else:
                flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
            
            print("Opening browser for 1-time Google Drive authorization...")
            creds = flow.run_local_server(port=0)
            
        with open(TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())
        print(f"Success! Permanent credentials saved to {TOKEN_FILE}")

if __name__ == '__main__':
    authenticate()
