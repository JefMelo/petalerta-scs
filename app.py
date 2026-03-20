import streamlit as st
from streamlit_gsheets import GSheetsConnection
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

# --- INICIALIZAÇÃO DE ESTADOS ---
if 'pagina' not in st.session_state: st.session_state.pagina = 'home'
if 'logado' not in st.session_state: st.session_state.logado = False
if 'user' not in st.session_state: st.session_state.user = {}
if 'temp_lat' not in st.session_state: st.session_state.temp_lat = None
if 'temp_lng' not in st.session_state: st.session_state.temp_lng = None
if 'temp_end' not in st.session_state: st.session_state.temp_end = ""
if 'foto_ampliada' not in st.session_state: st.session_state.foto_ampliada = None

SCS_COORDS = [-29.7182, -52.4306]
geolocator = Nominatim(user_agent="petalerta_scs_2026_v1")
conn = st.connection("gsheets", type=GSheetsConnection)

# --- INJEÇÃO DE CSS PARA O ZOOM (LIGHTBOX) ---
st.markdown("""
<style>
.lightbox-overlay {
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background-color: rgba(0, 0, 0, 0.85);
    z-index: 9999; display: flex;
    justify-content: center; align-items: center;
}
.lightbox-image {
    max-width: 90%; max-height: 90%;
    border-radius: 10px; border: 3px solid white;
}
</style>
""", unsafe_allow_html=True)

# --- FUNÇÕES DE SUPORTE ---

def verificar_login(user_in, pwd_in):
    try:
        df_u = conn.read(worksheet="Usuarios", ttl=0)
        if df_u is None or df_u.empty: return None
        u_clean = str(user_in).strip().lower()
        p_clean = str(pwd_in).strip()
        for _, row in df_u.iterrows():
            db_user = str(row['Usuario']).strip().lower()
            db_pass = str(row['Senha']).strip()
            if db_pass.endswith('.0'): db_pass = db_pass[:-2]
            if u_clean == db_user and p_clean == db_pass:
                return row.to_dict()
        return None
    except Exception as e:
        st.error(f"Erro ao acessar Usuarios: {e}")
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

def buscar_dados(aba_index=0):
    try:
        df = conn.read(worksheet=aba_index, ttl=0)
        if df is None or df.empty: return pd.DataFrame()
        return df.astype(str).replace('nan', '')
    except: return pd.DataFrame()

def ir_para(pagina):
    st.session_state.pagina = pagina
    st.rerun()

# --- LÓGICA DO ZOOM ---
if st.session_state.foto_ampliada:
    img_html = f'<img src="data:image/jpeg;base64,{st.session_state.foto_ampliada}" class="lightbox-image">'
    st.markdown(f'<div class="lightbox-overlay">{img_html}</div>', unsafe_allow_html=True)
    if st.button("❌ Fechar Zoom", key="close_zoom"):
        st.session_state.foto_ampliada = None
        st.rerun()

# --- SIDEBAR ---
with st.sidebar:
    st.header("👤 Área de Membros")
    if not st.session_state.logado:
        u_login = st.text_input("Usuário", key="login_user")
        p_login = st.text_input("Senha", type="password", key="login_pass")
        if st.button("Entrar", use_container_width=True):
            dados = verificar_login(u_login, p_login)
            if dados:
                st.session_state.logado, st.session_state.user = True, dados
                st.rerun()
            else: st.error("Usuário ou senha incorretos.")
        if st.button("Criar Conta", use_container_width=True): ir_para('cadastro_user')
    else:
        st.success(f"Olá, {str(st.session_state.user.get('Nome', 'Usuário')).split()[0]}!")
        if st.button("📍 Meus Pets", use_container_width=True): ir_para('meus_pets')
        if st.button("🏠 Início", use_container_width=True): ir_para('home')
        if st.button("🚪 Sair", use_container_width=True):
            st.session_state.logado = False
            st.session_state.user = {}
            ir_para('home')

# --- TELA 1: HOME ---
if st.session_state.pagina == 'home':
    st.title("🐾 PetAlerta Santa Cruz do Sul")
    df = buscar_dados(0)
    
    # Mapa
    m_h = folium.Map(location=SCS_COORDS, zoom_start=14)
    if not df.empty:
        for _, pet in df[df['Status'] == 'Perdido'].iterrows():
            try:
                lat, lng = float(pet['Lat']), float(pet['Lng'])
                folium.Marker([lat, lng], popup=f"{pet['Nome_Pet']} ({pet['Especie']})", 
                              icon=folium.Icon(color='red', icon='info-sign')).add_to(m_h)
            except: continue
    st_folium(m_h, width='stretch', height=400, key="home_map")
    
    if st.session_state.logado:
        if st.button("🚨 REGISTRAR PET PERDIDO", use_container_width=True, type="primary"): ir_para('perdi_pet')
    
    st.subheader("🔍 Mural de Desaparecidos")
    if not df.empty:
        perdidos = df[df['Status'] == 'Perdido']
        for _, pet in perdidos.iterrows():
            with st.container(border=True):
                col1, col2 = st.columns([1, 1.5])
                with col1:
                    if pet['Foto']:
                        st.image(f"data:image/jpeg;base64,{pet['Foto']}", use_container_width=True)
                        if st.button("🔍 Zoom", key=f"z_{pet['ID']}"):
                            st.session_state.foto_ampliada = pet['Foto']
                            st.rerun()
                with col2:
                    st.subheader(pet['Nome_Pet'])
                    st.write(f"📍 {pet['Local_Desaparecimento']}")
                    if st.session_state.logado:
                        tel = "".join(filter(str.isdigit, str(pet['Tel_Tutor'])))
                        st.link_button(f"💬 Contatar Tutor", f"https://wa.me/55{tel}", use_container_width=True)

# --- TELA 2: CADASTRO USUÁRIO (ORDE DE COLUNAS CORRIGIDA) ---
elif st.session_state.pagina == 'cadastro_user':
    st.title("📝 Criar Conta")
    with st.form("f_cad"):
        n = st.text_input("Nome Completo*")
        tl = st.text_input("WhatsApp (DDD+Número)*")
        em = st.text_input("E-mail*")
        us = st.text_input("Usuário (Login)*")
        pw = st.text_input("Senha*", type="password")
        if st.form_submit_button("CADASTRAR"):
            if n and tl and em and us and pw:
                df_u = conn.read(worksheet="Usuarios", ttl=0)
                # Ordem da sua Planilha: Usuario,Senha,Nivel,Telefone,Email,Nascimento,Endereco,Nome
                novo_u = pd.DataFrame([{
                    "Usuario": us, "Senha": pw, "Nivel": "Membro", "Telefone": tl,
                    "Email": em, "Nascimento": "", "Endereco": "", "Nome": n
                }])
                conn.update(worksheet="Usuarios", data=pd.concat([df_u, novo_u], ignore_index=True))
                st.success("Conta criada!")
                ir_para('home')
    st.button("Voltar", on_click=lambda: ir_para('home'))

# --- TELA 3: REGISTRO PET ---
elif st.session_state.pagina == 'perdi_pet':
    st.header("🚨 Registrar Animal")
    m_s = folium.Map(location=SCS_COORDS, zoom_start=15)
    map_res = st_folium(m_s, width='stretch', height=300, key="reg_map")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat = map_res["last_clicked"]["lat"]
        st.session_state.temp_lng = map_res["last_clicked"]["lng"]
        st.success(f"Local marcado!")

    with st.form("form_pet"):
        nome_p = st.text_input("Nome do PET*")
        esp = st.selectbox("Espécie", ["Cão", "Gato", "Outro"])
        foto = st.file_uploader("Foto")
        if st.form_submit_button("PUBLICAR"):
            if nome_p and st.session_state.temp_lat:
                foto_s = processar_foto(foto)
                df_b = buscar_dados(0)
                u = st.session_state.user
                novo = pd.DataFrame([{
                    "ID": str(int(datetime.now().timestamp())), "Data": datetime.now().strftime("%d/%m/%Y"),
                    "Status": "Perdido", "Especie": esp, "Nome_Pet": nome_p, "Foto": foto_s,
                    "Lat": st.session_state.temp_lat, "Lng": st.session_state.temp_lng,
                    "Local_Desaparecimento": "Santa Cruz do Sul", "Nome_Tutor": u['Nome'],
                    "Tel_Tutor": u['Telefone'], "User_Vinculo": u['Usuario']
                }])
                conn.update(worksheet=0, data=pd.concat([df_b, novo], ignore_index=True))
                st.success("Publicado!")
                ir_para('home')

elif st.session_state.pagina == 'meus_pets':
    st.header("📋 Meus Alertas")
    df_all = buscar_dados(0)
    meus = df_all[df_all['User_Vinculo'] == st.session_state.user['Usuario']]
    for _, p in meus.iterrows():
        with st.container(border=True):
            st.subheader(p['Nome_Pet'])
            if st.button(f"Marcar como Encontrado", key=f"b_{p['ID']}"):
                df_all.loc[df_all['ID'] == p['ID'], 'Status'] = 'Encontrado'
                conn.update(worksheet=0, data=df_all)
                st.rerun()
    st.button("Voltar", on_click=lambda: ir_para('home'))
