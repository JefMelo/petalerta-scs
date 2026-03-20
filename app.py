import streamlit as st
import pandas as pd
from datetime import datetime
import base64
from PIL import Image
import io
import folium
from streamlit_folium import st_folium
from geopy.geocoders import Nominatim

# 1. Configuração Inicial
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- CONFIGURAÇÕES TÉCNICAS ---
# O ID da sua planilha extraído do link que você enviou
SHEET_ID = "1RyredbJZsCPQvBxXqYmX1vBZJRgYToffm5agPxDBDRk"

# Nomes das abas conforme sua planilha
ABA_USUARIOS = "Usuarios"
ABA_PETS = "Pets" # Certifique-se de que a aba de alertas se chama 'Pets' na planilha

# --- INICIALIZAÇÃO DE ESTADOS ---
if 'pagina' not in st.session_state: st.session_state.pagina = 'home'
if 'logado' not in st.session_state: st.session_state.logado = False
if 'user' not in st.session_state: st.session_state.user = {}
if 'temp_lat' not in st.session_state: st.session_state.temp_lat = None
if 'temp_lng' not in st.session_state: st.session_state.temp_lng = None
if 'foto_ampliada' not in st.session_state: st.session_state.foto_ampliada = None

SCS_COORDS = [-29.7182, -52.4306]
geolocator = Nominatim(user_agent="petalerta_scs_2026_final")

# --- CONEXÃO PARA GRAVAÇÃO (Secrets deve estar configurado) ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# --- FUNÇÃO DE LEITURA DIRETA (MÉTODO CSV QUE PULA ERROS DE API) ---
def ler_planilha_direto(nome_aba):
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={nome_aba}"
    try:
        df = pd.read_csv(url)
        return df.astype(str).replace('nan', '')
    except Exception as e:
        st.error(f"Erro ao ler aba '{nome_aba}': Verifique se o nome no rodapé da planilha está correto.")
        return pd.DataFrame()

# --- INJEÇÃO DE CSS PARA O ZOOM ---
st.markdown("""
<style>
.lightbox-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background-color: rgba(0, 0, 0, 0.85); z-index: 9999;
    display: flex; justify-content: center; align-items: center;
}
.lightbox-image { max-width: 90%; max-height: 90%; border-radius: 10px; border: 3px solid white; }
</style>
""", unsafe_allow_html=True)

# --- FUNÇÕES DE LÓGICA ---
def verificar_login(user_in, pwd_in):
    df_u = ler_planilha_direto(ABA_USUARIOS)
    if df_u.empty: return None
    u_clean = str(user_in).strip().lower()
    p_clean = str(pwd_in).strip()
    for _, row in df_u.iterrows():
        db_user = str(row['Usuario']).strip().lower()
        db_pass = str(row['Senha']).strip()
        if db_pass.endswith('.0'): db_pass = db_pass[:-2]
        if u_clean == db_user and p_clean == db_pass:
            return row.to_dict()
    return None

def processar_foto(arquivo):
    if arquivo:
        img = Image.open(arquivo)
        if img.mode in ("RGBA", "P"): img = img.convert("RGB")
        img.thumbnail((800, 800))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=75)
        return base64.b64encode(buf.getvalue()).decode()
    return ""

def ir_para(pagina):
    st.session_state.pagina = pagina
    st.rerun()

# --- ZOOM LIGHTBOX ---
if st.session_state.foto_ampliada:
    img_html = f'<img src="data:image/jpeg;base64,{st.session_state.foto_ampliada}" class="lightbox-image">'
    st.markdown(f'<div class="lightbox-overlay">{img_html}</div>', unsafe_allow_html=True)
    if st.button("❌ Fechar Zoom"):
        st.session_state.foto_ampliada = None
        st.rerun()

# --- SIDEBAR ---
with st.sidebar:
    st.header("👤 Área de Membros")
    if not st.session_state.logado:
        u_login = st.text_input("Usuário")
        p_login = st.text_input("Senha", type="password")
        if st.button("Entrar", use_container_width=True):
            user_data = verificar_login(u_login, p_login)
            if user_data:
                st.session_state.logado, st.session_state.user = True, user_data
                st.rerun()
            else: st.error("Login inválido.")
        if st.button("Criar Conta", use_container_width=True): ir_para('cadastro_user')
    else:
        st.success(f"Olá, {str(st.session_state.user.get('Nome', 'Usuário')).split()[0]}!")
        if st.button("🏠 Início", use_container_width=True): ir_para('home')
        if st.button("📍 Meus Pets", use_container_width=True): ir_para('meus_pets')
        if st.button("🚪 Sair", use_container_width=True):
            st.session_state.logado = False
            ir_para('home')

# --- TELA: HOME ---
if st.session_state.pagina == 'home':
    st.title("🐾 PetAlerta Santa Cruz do Sul")
    
    df = ler_planilha_direto(ABA_PETS)
    
    m = folium.Map(location=SCS_COORDS, zoom_start=14)
    if not df.empty:
        for _, pet in df[df['Status'] == 'Perdido'].iterrows():
            try:
                folium.Marker(
                    [float(pet['Lat']), float(pet['Lng'])],
                    popup=f"{pet['Nome_Pet']} - {pet['Especie']}",
                    icon=folium.Icon(color='red', icon='info-sign')
                ).add_to(m)
            except: continue
    st_folium(m, width='stretch', height=400)

    if st.session_state.logado:
        if st.button("🚨 REGISTRAR PET PERDIDO", use_container_width=True, type="primary"): ir_para('perdi_pet')
    
    st.subheader("🔍 Mural de Desaparecidos")
    if not df.empty:
        perdidos = df[df['Status'] == 'Perdido']
        for _, pet in perdidos.iterrows():
            with st.container(border=True):
                c1, c2 = st.columns([1, 1.5])
                with c1:
                    if pet['Foto']:
                        st.image(f"data:image/jpeg;base64,{pet['Foto']}", use_container_width=True)
                        if st.button("🔍 Zoom", key=f"z_{pet['ID']}"):
                            st.session_state.foto_ampliada = pet['Foto']
                            st.rerun()
                with c2:
                    st.subheader(pet['Nome_Pet'])
                    st.write(f"📍 {pet['Local_Desaparecimento']}")
                    if st.session_state.logado:
                        tel_limpo = "".join(filter(str.isdigit, str(pet['Tel_Tutor'])))
                        st.link_button("💬 Contatar Tutor", f"https://wa.me/55{tel_limpo}", use_container_width=True)

# --- TELA: CADASTRO USUÁRIO ---
elif st.session_state.pagina == 'cadastro_user':
    st.header("📝 Criar Conta")
    with st.form("f_cad"):
        n = st.text_input("Nome Completo*")
        tl = st.text_input("WhatsApp (DDD+Número)*")
        em = st.text_input("E-mail*")
        us = st.text_input("Usuário (Login)*")
        pw = st.text_input("Senha*", type="password")
        if st.form_submit_button("CADASTRAR"):
            if n and tl and em and us and pw:
                df_u = ler_planilha_direto(ABA_USUARIOS)
                novo_u = pd.DataFrame([{
                    "Usuario": us, "Senha": pw, "Nivel": "Membro", "Telefone": tl,
                    "Email": em, "Nascimento": "", "Endereco": "", "Nome": n
                }])
                conn.update(worksheet=ABA_USUARIOS, data=pd.concat([df_u, novo_u], ignore_index=True))
                st.success("Conta criada! Entre pela lateral.")
                ir_para('home')
    st.button("Voltar", on_click=lambda: ir_para('home'))

# --- TELA: REGISTRO PET ---
elif st.session_state.pagina == 'perdi_pet':
    st.header("🚨 Registrar Animal")
    m_reg = folium.Map(location=SCS_COORDS, zoom_start=15)
    map_res = st_folium(m_reg, width='stretch', height=300, key="map_reg")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat = map_res["last_clicked"]["lat"]
        st.session_state.temp_lng = map_res["last_clicked"]["lng"]
        st.success("Local marcado!")

    with st.form("f_pet"):
        nome_p = st.text_input("Nome do Pet*")
        esp = st.selectbox("Espécie", ["Cão", "Gato", "Outro"])
        foto = st.file_uploader("Foto")
        if st.form_submit_button("PUBLICAR"):
            if nome_p and st.session_state.temp_lat:
                foto_b64 = processar_foto(foto)
                df_p = ler_planilha_direto(ABA_PETS)
                u = st.session_state.user
                novo_pet = pd.DataFrame([{
                    "ID": str(int(datetime.now().timestamp())), "Data": datetime.now().strftime("%d/%m/%Y"),
                    "Status": "Perdido", "Especie": esp, "Nome_Pet": nome_p, "Foto": foto_b64,
                    "Lat": st.session_state.temp_lat, "Lng": st.session_state.temp_lng,
                    "Local_Desaparecimento": "Santa Cruz do Sul", "Nome_Tutor": u['Nome'],
                    "Tel_Tutor": u['Telefone'], "User_Vinculo": u['Usuario']
                }])
                conn.update(worksheet=ABA_PETS, data=pd.concat([df_p, novo_pet], ignore_index=True))
                st.success("Pet cadastrado!")
                ir_para('home')
