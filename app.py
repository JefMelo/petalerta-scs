import streamlit as st
import pandas as pd
from datetime import datetime
import requests
import base64
import folium
from streamlit_folium import st_folium

# 1. Configuração Inicial
st.set_page_config(page_title="PetAlerta SCS", page_icon="🐾", layout="centered")

# --- CONFIGURAÇÕES TÉCNICAS ---
SHEET_ID = "1RyredbJZsCPQvBxXqYmX1vBZJRgYToffm5agPxDBDRk"
IMGBB_API_KEY = "54494e69c28056a133620f4e8be0ab72"
ABA_USUARIOS = "Usuarios"
ABA_PETS = "Dados" 

# --- INICIALIZAÇÃO DE ESTADOS ---
if 'pagina' not in st.session_state: st.session_state.pagina = 'home'
if 'logado' not in st.session_state: st.session_state.logado = False
if 'user' not in st.session_state: st.session_state.user = {}
if 'temp_lat' not in st.session_state: st.session_state.temp_lat = None
if 'temp_lng' not in st.session_state: st.session_state.temp_lng = None
if 'pagina_detalhes' not in st.session_state: st.session_state.pagina_detalhes = None

SCS_COORDS = [-29.7182, -52.4306]

# --- CONEXÃO G-SHEETS (OFICIAL) ---
from streamlit_gsheets import GSheetsConnection
conn = st.connection("gsheets", type=GSheetsConnection)

# --- FUNÇÃO DE LEITURA (CORRIGIDA: COM CACHE ATIVADO) ---
def ler_planilha_direto(nome_aba):
    try:
        # ttl=15 guarda a planilha na memória por 15 segundos!
        # Isso salva a nossa cota da API do Google e deixa o site MUITO mais rápido.
        df = conn.read(worksheet=nome_aba, ttl=15, dtype=str)
        df = df.dropna(how='all')
        df.columns = df.columns.str.strip()
        df = df.fillna("")
        
        # Varredura de limpeza
        for col in df.columns:
            if col not in ['Lat', 'Lng']:
                df[col] = df[col].astype(str).str.replace(r'\.0$', '', regex=True)
                df[col] = df[col].replace('nan', '')
                
        return df
    except Exception as e:
        st.error(f"Erro ao conectar com a planilha: {e}")
        return pd.DataFrame()

# --- FUNÇÃO UPLOAD IMGBB ---
def fazer_upload_imgbb(arquivo):
    if arquivo:
        try:
            url = f"https://api.imgbb.com/1/upload?key={IMGBB_API_KEY}"
            img_b64 = base64.b64encode(arquivo.getvalue()).decode('utf-8')
            payload = {"image": img_b64}
            response = requests.post(url, data=payload)
            data = response.json()
            if data.get("status") == 200:
                return data["data"]["url"]
            else:
                st.error(f"Erro no ImgBB: {data.get('error', {}).get('message', '')}")
                return ""
        except Exception as e:
            st.error(f"Falha de conexão com ImgBB: {e}")
            return ""
    return ""

# --- INJEÇÃO DE CSS ---
st.markdown("""
<style>
    .pet-card {
        border: 2px solid #ddd; border-radius: 12px; margin-bottom: 25px;
        background-color: #fff; box-shadow: 3px 3px 10px rgba(0,0,0,0.1); overflow: hidden;
    }
    .pet-card-header { background-color: #f8f9fa; padding: 12px 18px; border-bottom: 2px solid #eee; }
    .pet-card h3 { margin: 0; color: #2c3e50; font-size: 1.5rem; }
    .pet-card-body { display: flex; gap: 15px; padding: 15px; flex-wrap: wrap; }
    .pet-card-foto { width: 150px; height: 150px; object-fit: cover; border-radius: 10px; border: 1px solid #ddd; cursor: pointer; }
    .pet-card-info { flex: 1; min-width: 200px; }
    .pet-card-footer { background: #fafafa; padding: 10px 15px; border-top: 1px solid #eee; }
</style>
""", unsafe_allow_html=True)

# --- FUNÇÃO DE NAVEGAÇÃO SEGURA ---
def ir_para(p):
    st.session_state.pagina = p
    st.session_state.pagina_detalhes = None
    st.rerun()

# --- PÁGINA DE ZOOM ---
if st.session_state.pagina_detalhes:
    st.image(st.session_state.pagina_detalhes, use_container_width=True)
    if st.button("⬅️ VOLTAR AO MURAL", use_container_width=True, type="primary"):
        st.session_state.pagina_detalhes = None
        st.rerun()
    st.stop()

# --- SIDEBAR (LOGIN) ---
with st.sidebar:
    st.title("🐾 Menu")
    if not st.session_state.logado:
        u_l = st.text_input("Usuário")
        p_l = st.text_input("Senha", type="password")
        if st.button("Entrar", use_container_width=True):
            df_u = ler_planilha_direto(ABA_USUARIOS)
            u_clean = u_l.strip().lower()
            p_clean = p_l.strip()
            user_found = None
            if not df_u.empty:
                for _, r in df_u.iterrows():
                    db_p = str(r.get('Senha', '')).replace('.0', '')
                    if str(r.get('Usuario', '')).lower() == u_clean and db_p == p_clean:
                        user_found = r.to_dict()
                        break
            if user_found:
                st.session_state.logado, st.session_state.user = True, user_found
                st.rerun()
            else: st.error("Login inválido")
        
        if st.button("Criar Conta", use_container_width=True): 
            ir_para('cadastro_user')
    else:
        st.success(f"Olá, {st.session_state.user.get('Nome', 'Usuário').split()[0]}")
        
        if st.button("🏠 Home", use_container_width=True): 
            ir_para('home')
        if st.button("🚪 Sair", use_container_width=True):
            st.session_state.logado = False
            ir_para('home')

# ==========================================
# ROTAS DE PÁGINAS
# ==========================================

# --- PÁGINA: HOME ---
if st.session_state.pagina == 'home':
    st.title("🐾 PetAlerta Santa Cruz do Sul")
    df = ler_planilha_direto(ABA_PETS)

    # Função super inteligente que ignora acentos, espaços e maiúsculas
    def valor_seguro(linha, coluna):
        v = str(linha.get(coluna, '')).strip()
        if v and v.lower() not in ['nan', 'none', '']:
            return v
        
        # Se não achou exato, tenta ignorar acentos e letras "ç" da planilha
        col_limpa = coluna.lower().replace('ç','c').replace('é','e').replace('í','i').replace('á','a')
        for c_real in linha.index:
            c_real_limpa = str(c_real).lower().replace('ç','c').replace('é','e').replace('í','i').replace('á','a').strip()
            if c_real_limpa == col_limpa:
                val = str(linha[c_real]).strip()
                if val and val.lower() not in ['nan', 'none', '']:
                    return val
        return '-'

    m = folium.Map(location=SCS_COORDS, zoom_start=14)
    if not df.empty:
        for _, pet in df.iterrows():
            try:
                if valor_seguro(pet, 'Status') == 'Perdido':
                    esp = valor_seguro(pet, 'Especie').lower()
                    icon_c = 'orange' if 'cão' in esp or 'cao' in esp else ('blue' if 'gato' in esp else 'green')
                    nome_mapa = valor_seguro(pet, 'Nome_Pet')
                    nome_mapa = "Pet" if nome_mapa == '-' else nome_mapa
                    
                    lat_v = valor_seguro(pet, 'Lat')
                    lng_v = valor_seguro(pet, 'Lng')
                    if lat_v != '-' and lng_v != '-':
                        folium.Marker([float(lat_v), float(lng_v)], 
                                      popup=f"<b>{nome_mapa}</b>", 
                                      icon=folium.Icon(color=icon_c, icon='paw', prefix='fa')).add_to(m)
            except: continue
    st_folium(m, width=700, height=400)

    if st.session_state.logado:
        if st.button("🚨 REGISTRAR PET PERDIDO", type="primary", use_container_width=True):
            ir_para('perdi_pet')

    st.subheader("🔍 Mural de Desaparecidos")
    if not df.empty:
        for _, pet in df.iterrows():
            if valor_seguro(pet, 'Status') == 'Perdido':
                
                foto_src = valor_seguro(pet, 'Foto')
                if foto_src == '-': foto_src = ""
                nome_pet = valor_seguro(pet, 'Nome_Pet')
                nome_pet = "Pet sem nome" if nome_pet == '-' else nome_pet
                
                st.markdown(f'''
                    <div class="pet-card">
                        <div class="pet-card-header">
                            <h3>{nome_pet}</h3>
                        </div>
                        <div class="pet-card-body">
                            <img src="{foto_src}" class="pet-card-foto" onerror="this.style.display='none'">
                            <div class="pet-card-info">
                                <p><b>Espécie:</b> {valor_seguro(pet, 'Especie')} | <b>Raça:</b> {valor_seguro(pet, 'Raca')}</p>
                                <p><b>Cor:</b> {valor_seguro(pet, 'Cor')}</p>
                                <p><b>Características:</b> {valor_seguro(pet, 'Caracteristicas')}</p>
                            </div>
                        </div>
                        <div class="pet-card-footer">
                            <p>📍 <i>Desapareceu em: {valor_seguro(pet, 'Data')} - Visto em: {valor_seguro(pet, 'Local_Desaparecimento')}</i></p>
                        </div>
                    </div>
                ''', unsafe_allow_html=True)
                
                c1, c2 = st.columns(2)
                with c1:
                    if foto_src and st.button("🔍 Ver Foto", key=f"z_{valor_seguro(pet, 'ID')}", use_container_width=True):
                        st.session_state.pagina_detalhes = foto_src
                        st.rerun()
                with c2:
                    if st.session_state.logado:
                        tel_bruto = valor_seguro(pet, 'Tel_Tutor')
                        tel = "".join(filter(str.isdigit, tel_bruto))
                        if len(tel) >= 10: # Se achou um número válido
                            st.link_button("🟢 WhatsApp", f"https://wa.me/55{tel}", use_container_width=True)
                        else: # Se não tem telefone, mostra o botão inativo
                            st.button("🚫 Sem Contato", disabled=True, key=f"w_{valor_seguro(pet, 'ID')}", use_container_width=True)
                st.write("")
                
# --- PÁGINA: REGISTRO PET ---
elif st.session_state.pagina == 'perdi_pet':
    st.header("🚨 Registrar Animal Perdido")
    st.info("Clique no mapa para marcar o local.")
    m_reg = folium.Map(location=SCS_COORDS, zoom_start=15)
    if st.session_state.temp_lat:
        folium.Marker([st.session_state.temp_lat, st.session_state.temp_lng], icon=folium.Icon(color='red')).add_to(m_reg)
    map_res = st_folium(m_reg, width=700, height=300, key="map_reg")
    if map_res and map_res.get("last_clicked"):
        st.session_state.temp_lat, st.session_state.temp_lng = map_res["last_clicked"]["lat"], map_res["last_clicked"]["lng"]
        st.rerun()

    with st.form("f_pet"):
        nome_p = st.text_input("Nome do Pet*")
        esp = st.selectbox("Espécie", ["Cão", "Gato", "Outro"])
        raca, cor = st.text_input("Raça"), st.text_input("Cor Principal")
        caract = st.text_area("Características marcantes")
        bairro = st.text_input("Bairro/Local aproximado")
        foto = st.file_uploader("Foto do Pet")
        
        if st.form_submit_button("🚀 PUBLICAR"):
            if nome_p and st.session_state.temp_lat:
                with st.spinner("Enviando foto e salvando dados..."):
                    
                    url_foto = fazer_upload_imgbb(foto) if foto else ""
                    u = st.session_state.user
                    
                    # DICIONÁRIO ESTRITAMENTE FIXO CONFORME SOLICITADO
                    dados_novos = {
                        "ID": str(int(datetime.now().timestamp())),
                        "Status": "Perdido",
                        "Data": datetime.now().strftime('%d/%m/%Y'),
                        "Especie": esp,
                        "Nome_Pet": nome_p,
                        "Raca": raca,
                        "Cor": cor,
                        "Caracteristicas": caract,
                        "Local_Desaparecimento": bairro,
                        "Lat": str(st.session_state.temp_lat),
                        "Lng": str(st.session_state.temp_lng),
                        "Foto": url_foto,
                        "Nome_Tutor": u.get('Nome', ''),
                        "Tel_Tutor": u.get('Telefone', ''),
                        "User_Vinculo": u.get('Usuario', ''),
                        "Nascimento_Tutor": u.get('Nascimento', ''),
                        "Telefone_Tutor": u.get('Telefone', ''),
                        "Email_Tutor": u.get('Email', ''),
                        "Endereco_Tutor": u.get('Endereco', '')
                    }
                    
                    try:
                            df_p = ler_planilha_direto(ABA_PETS)
                            df_final = pd.concat([df_p, pd.DataFrame([dados_novos])], ignore_index=True)
                            conn.update(worksheet=ABA_PETS, data=df_final)
                            
                            st.cache_data.clear() # <--- ADICIONE ESTA LINHA AQUI! (Limpa a memória)
                            
                            st.session_state.temp_lat = None
                            st.success("✅ Pet cadastrado com sucesso!")
                            ir_para('home')
            else:
                st.error("Preencha o nome e marque o local no mapa.")

# --- PÁGINA: CADASTRO USUÁRIO ---
elif st.session_state.pagina == 'cadastro_user':
    st.header("📝 Criar Conta")
    with st.form("cad_u"):
        n, t, e, u_cad, p_cad = st.text_input("Nome"), st.text_input("WhatsApp"), st.text_input("Email"), st.text_input("Usuário"), st.text_input("Senha", type="password")
        if st.form_submit_button("CADASTRAR"):
            df_u = ler_planilha_direto(ABA_USUARIOS)
            novo = pd.DataFrame([{"Usuario":u_cad,"Senha":p_cad,"Nivel":"Membro","Telefone":t,"Email":e,"Nascimento":"","Endereco":"","Nome":n}])
            conn.update(worksheet=ABA_USUARIOS, data=pd.concat([df_u, novo], ignore_index=True))
            st.success("Conta criada!")
            ir_para('home')
