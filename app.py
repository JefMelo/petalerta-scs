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
SHEET_ID = "1RyredbJZsCPQvBxXqYmX1vBZJRgYToffm5agPxDBDRk"
ABA_USUARIOS = "Usuarios"
ABA_PETS = "Pets" 

# --- INICIALIZAÇÃO DE ESTADOS ---
if 'pagina' not in st.session_state: st.session_state.pagina = 'home'
if 'logado' not in st.session_state: st.session_state.logado = False
if 'user' not in st.session_state: st.session_state.user = {}
if 'temp_lat' not in st.session_state: st.session_state.temp_lat = None
if 'temp_lng' not in st.session_state: st.session_state.temp_lng = None
if 'foto_ampliada' not in st.session_state: st.session_state.foto_ampliada = None

SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# --- FUNÇÃO DE LEITURA ---
def ler_planilha_direto(nome_aba):
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={nome_aba}"
    try:
        df = pd.read_csv(url)
        return df.astype(str).replace('nan', '')
    except:
        return pd.DataFrame()

# --- INJEÇÃO DE CSS (Cards Compactos e Lightbox) ---
st.markdown("""
<style>
    /* Estilo do Card do Mural (Menor e mais limpo) */
    .pet-card {
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 10px;
        margin-bottom: 12px;
        background-color: #ffffff;
        box-shadow: 2px 2px 5px rgba(0,0,0,0.05);
    }
    .pet-card h3 {
        margin: 0px;
        font-size: 1.1rem;
        color: #333;
    }
    .pet-card p {
        margin: 2px 0px;
        font-size: 0.9rem;
    }
    /* Estilo do Overlay do Zoom */
    .lightbox-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(0, 0, 0, 0.95); z-index: 9999;
        display: flex; justify-content: center; align-items: center;
    }
    .lightbox-image { 
        max-width: 90%; max-height: 80%; 
        border: 2px solid #fff; border-radius: 4px; 
    }
    /* Botão Flutuante para fechar o Zoom */
    .btn-close-zoom {
        position: fixed; top: 20px; right: 20px; z-index: 10000;
    }
</style>
""", unsafe_allow_html=True)

# --- FUNÇÕES DE LÓGICA ---
def verificar_login(user_in, pwd_in):
    df_u = ler_planilha_direto(ABA_USUARIOS)
    if df_u.empty: return None
    u_c, p_c = str(user_in).strip().lower(), str(pwd_in).strip()
    for _, r in df_u.iterrows():
        db_u, db_p = str(r['Usuario']).strip().lower(), str(r['Senha']).strip()
        if db_p.endswith('.0'): db_p = db_p[:-2]
        if u_c == db_u and p_c == db_p: return r.to_dict()
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

def ir_para(p):
    st.session_state.pagina = p
    st.rerun()

# --- INTERFACE DE ZOOM (Lightbox) ---
if st.session_state.foto_ampliada:
    # Mostra a imagem em tela cheia
    st.markdown(f'''
        <div class="lightbox-overlay">
            <img src="data:image/jpeg;base64,{st.session_state.foto_ampliada}" class="lightbox-image">
        </div>
    ''', unsafe_allow_html=True)
    
    # Botão centralizado para fechar (Limpa o estado)
    if st.button("❌ FECHAR FOTO", key="btn_fechar_lightbox", type="primary", use_container_width=True):
        st.session_state.foto_ampliada = None
        st.rerun()

# --- SIDEBAR ---
with st.sidebar:
    st.title("🐾 Menu")
    if not st.session_state.logado:
        u_l = st.text_input("Usuário")
        p_l = st.text_input("Senha", type="password")
        if st.button("Entrar", use_container_width=True):
            user = verificar_login(u_l, p_l)
            if user:
                st.session_state.logado, st.session_state.user = True, user
                st.rerun()
            else: st.error("Erro no login")
        if st.button("Criar Conta", use_container_width=True): ir_para('cadastro_user')
    else:
        st.success(f"Olá, {st.session_state.user['Nome'].split()[0]}")
        if st.button("🏠 Início", use_container_width=True): ir_para('home')
        if st.button("📍 Meus Alertas", use_container_width=True): ir_para('meus_pets')
        if st.button("🚪 Sair", use_container_width=True):
            st.session_state.logado = False
            ir_para('home')

# --- PÁGINA: HOME ---
if st.session_state.pagina == 'home':
    st.title("🐾 PetAlerta Santa Cruz do Sul")
    df = ler_planilha_direto(ABA_PETS)

    # 1. MAPA COM ÍCONES POR ESPÉCIE
    m = folium.Map(location=SCS_COORDS, zoom_start=14)
    if not df.empty:
        for _, pet in df[df['Status'] == 'Perdido'].iterrows():
            try:
                esp = str(pet['Especie']).lower()
                if 'cão' in esp or 'cao' in esp or 'cachorro' in esp:
                    icon_type, icon_img = 'orange', 'dog'
                elif 'gato' in esp:
                    icon_type, icon_img = 'blue', 'cat'
                else:
                    icon_type, icon_img = 'green', 'paw'

                folium.Marker(
                    [float(pet['Lat']), float(pet['Lng'])],
                    popup=f"<b>{pet['Nome_Pet']}</b>",
                    icon=folium.Icon(color=icon_type, icon=icon_img, prefix='fa')
                ).add_to(m)
            except: continue
    st_folium(m, width=700, height=400)

    if st.session_state.logado:
        st.button("🚨 REGISTRAR PET PERDIDO", on_click=lambda: ir_para('perdi_pet'), type="primary", use_container_width=True)

    st.divider()
    st.subheader("🔍 Mural de Desaparecidos")

    # 2. MURAL COM CARDS COMPACTOS
    if not df.empty:
        perdidos = df[df['Status'] == 'Perdido']
        for _, pet in perdidos.iterrows():
            # Início do Card
            st.markdown(f'''
                <div class="pet-card">
                    <h3>{pet['Nome_Pet']}</h3>
                    <p><b>Espécie:</b> {pet['Especie']} | <b>Bairro:</b> {pet['Local_Desaparecimento']}</p>
                </div>
            ''', unsafe_allow_html=True)
            
            # Botões e Imagem (Streamlit precisa renderizar fora do f-string de cima)
            col1, col2 = st.columns([1, 2])
            with col1:
                if pet['Foto']:
                    st.image(f"data:image/jpeg;base64,{pet['Foto']}", width=120)
                    if st.button("🔍 Zoom", key=f"zoom_{pet['ID']}"):
                        st.session_state.foto_ampliada = pet['Foto']
                        st.rerun()
            with col2:
                if st.session_state.logado:
                    tel = "".join(filter(str.isdigit, str(pet['Tel_Tutor'])))
                    st.link_button("🟢 WhatsApp", f"https://wa.me/55{tel}", use_container_width=True)
                else:
                    st.info("🔒 Logue para ver contato")
            st.markdown("---") # Linha sutil entre cards

# --- PÁGINA: CADASTRO USUÁRIO ---
elif st.session_state.pagina == 'cadastro_user':
    st.header("📝 Nova Conta")
    with st.form("cad_u"):
        n, t, e, u, p = st.text_input("Nome"), st.text_input("Whats"), st.text_input("Email"), st.text_input("User"), st.text_input("Pass", type="password")
        if st.form_submit_button("CADASTRAR"):
            df_u = ler_planilha_direto(ABA_USUARIOS)
            novo = pd.DataFrame([{"Usuario":u,"Senha":p,"Nivel":"Membro","Telefone":t,"Email":e,"Nascimento":"","Endereco":"","Nome":n}])
            conn.update(worksheet=ABA_USUARIOS, data=pd.concat([df_u, novo], ignore_index=True))
            st.success("Conta criada!")
            ir_para('home')

# --- PÁGINA: REGISTRO PET ---
elif st.session_state.pagina == 'perdi_pet':
    st.header("🚨 Registrar Animal Perdido")
    m_reg = folium.Map(location=SCS_COORDS, zoom_start=15)
    map_res = st_folium(m_reg, width=700, height=300, key="map_reg")
    
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat = map_res["last_clicked"]["lat"]
        st.session_state.temp_lng = map_res["last_clicked"]["lng"]
        st.success("Localização marcada!")

    with st.form("f_pet"):
        nome_p = st.text_input("Nome do Pet*")
        esp = st.selectbox("Espécie", ["Cão", "Gato", "Outro"])
        foto = st.file_uploader("Foto do Pet")
        if st.form_submit_button("PUBLICAR ALERTA"):
            if nome_p and st.session_state.temp_lat:
                foto_b64 = processar_foto(foto)
                df_p = ler_planilha_direto(ABA_PETS)
                u = st.session_state.user
                novo_p = pd.DataFrame([{
                    "ID": str(int(datetime.now().timestamp())), "Data": datetime.now().strftime("%d/%m/%Y"),
                    "Status": "Perdido", "Especie": esp, "Nome_Pet": nome_p, "Foto": foto_b64,
                    "Lat": st.session_state.temp_lat, "Lng": st.session_state.temp_lng,
                    "Local_Desaparecimento": "Santa Cruz do Sul", "Nome_Tutor": u['Nome'],
                    "Tel_Tutor": u['Telefone'], "User_Vinculo": u['Usuario']
                }])
                conn.update(worksheet=ABA_PETS, data=pd.concat([df_p, novo_p], ignore_index=True))
                st.success("Alerta publicado!")
                ir_para('home')
